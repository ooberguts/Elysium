import type { AudioFeatures } from './audio';
import { VISUALIZER_PRESETS, type VisualizerPreset } from './catalog';
import { bloomShader, compositeShader, sceneShader, vertexShader } from './shaders';
import { MusicalMotion } from './motion';

type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer };
type Program = { handle: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> };

/** Audio-driven feedback, quarter-size separable bloom, and a final dissolve.
 * All targets are bounded; no per-frame GPU allocations or synchronous readbacks. */
export class GpuVisualizer {
  private readonly gl: WebGLRenderingContext;
  private readonly programs: Program[] = [];
  private readonly textures: WebGLTexture[] = [];
  private readonly targets: Target[] = [];
  private readonly bloomTargets: Target[] = [];
  private buffer: WebGLBuffer | null = null;
  private scene!: Program;
  private composite!: Program;
  private bloom!: Program;
  private audioTexture!: WebGLTexture;
  private previous!: WebGLTexture;
  private readonly samples = new Uint8Array(1024 * 2);
  private width = 0;
  private height = 0;
  private front = 0;
  private mode = 3;
  private readonly motion = new MusicalMotion();
  private historyReady = false;
  private transition = 1;
  private hasFrame = false;

  static create(canvas: HTMLCanvasElement): GpuVisualizer | null {
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    });
    if (!gl) return null;
    const renderer = new GpuVisualizer(gl);
    try {
      renderer.initialize();
      return renderer;
    } catch (error) {
      console.warn('Elysium: using the Canvas visualizer fallback.', error);
      renderer.dispose(true);
      return null;
    }
  }

  private constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
  }

  private initialize() {
    const gl = this.gl;
    this.scene = this.program(sceneShader);
    this.composite = this.program(compositeShader);
    this.bloom = this.program(bloomShader);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    for (const p of this.programs) {
      gl.useProgram(p.handle);
      const location = gl.getAttribLocation(p.handle, 'position');
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    }
    this.audioTexture = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1024, 2, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null);
    this.previous = this.texture();
    for (let i = 0; i < 2; i++) {
      const texture = this.texture(),
        framebuffer = gl.createFramebuffer();
      if (!framebuffer) throw new Error('Framebuffer unavailable');
      this.targets.push({ texture, framebuffer });
    }
    for (let i = 0; i < 2; i++) {
      const texture = this.texture(),
        framebuffer = gl.createFramebuffer();
      if (!framebuffer) throw new Error('Bloom framebuffer unavailable');
      this.bloomTargets.push({ texture, framebuffer });
    }
  }

  private program(fragment: string): Program {
    const gl = this.gl;
    const handle = gl.createProgram();
    if (!handle) throw new Error('Shader program unavailable');
    const shaders: WebGLShader[] = [];
    try {
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vertexShader],
        [gl.FRAGMENT_SHADER, fragment],
      ] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Shader unavailable');
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error(gl.getShaderInfoLog(shader) || 'Shader compilation failed');
        gl.attachShader(handle, shader);
      }
      gl.linkProgram(handle);
      if (!gl.getProgramParameter(handle, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(handle) || 'Shader linking failed');
      const program = { handle, uniforms: new Map<string, WebGLUniformLocation | null>() };
      this.programs.push(program);
      return program;
    } catch (error) {
      gl.deleteProgram(handle);
      throw error;
    } finally {
      shaders.forEach((shader) => gl.deleteShader(shader));
    }
  }

  private texture() {
    const gl = this.gl,
      texture = gl.createTexture();
    if (!texture) throw new Error('Texture unavailable');
    this.textures.push(texture);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private uniform(program: Program, name: string) {
    if (!program.uniforms.has(name))
      program.uniforms.set(name, this.gl.getUniformLocation(program.handle, name));
    return program.uniforms.get(name)!;
  }

  private bind(program: Program, name: string, texture: WebGLTexture, unit: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.uniform(program, name), unit);
  }

  resize(width: number, height: number) {
    if (width === this.width && height === this.height) return;
    const gl = this.gl;
    this.width = width;
    this.height = height;
    gl.viewport(0, 0, width, height);
    // Textures are non-power-of-two and use clamp/linear filtering for WebGL 1.
    for (const texture of [...this.targets.map((t) => t.texture), this.previous]) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // The opaque default framebuffer is RGB; WebKit rejects copies into
      // RGBA textures when the source has no alpha channel.
      const format = texture === this.previous ? gl.RGB : gl.RGBA;
      gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, gl.UNSIGNED_BYTE, null);
    }
    for (const target of this.targets) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        target.texture,
        0,
      );
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('Incomplete visualizer framebuffer');
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    for (const target of this.bloomTargets) {
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        Math.max(1, Math.ceil(width / 4)),
        Math.max(1, Math.ceil(height / 4)),
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        target.texture,
        0,
      );
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('Incomplete bloom framebuffer');
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.hasFrame = false;
    this.historyReady = false;
    this.transition = 1;
  }

  setPreset(preset: VisualizerPreset, reduced = false) {
    const next = VISUALIZER_PRESETS.findIndex((p) => p.id === preset.id);
    if (next === this.mode) return;
    // Re-render the current composite before copying: the default framebuffer may
    // have been discarded by the browser since the last animation frame.
    if (this.hasFrame && !reduced) {
      this.present();
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.previous);
      this.gl.copyTexSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, 0, 0, this.width, this.height);
      this.transition = 0;
    } else this.transition = 1;
    this.mode = Math.max(0, next);
    this.historyReady = false;
    for (const target of this.targets) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.framebuffer);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  get transitioning() {
    return this.transition < 1;
  }

  draw(delta: number, f: AudioFeatures, reduced: boolean, intensity = 1, animate = true) {
    const gl = this.gl,
      dt = Math.min(0.1, Math.max(0, delta));
    this.motion.update(dt, f, animate, reduced);
    this.transition = reduced ? 1 : Math.min(1, this.transition + dt / 1.8);
    for (let i = 0; i < 1024; i++) {
      this.samples[i] = Math.round(Math.min(1, f.bands[Math.min(63, Math.floor(i / 16))]) * 255);
      this.samples[1024 + i] = Math.round((Math.max(-1, Math.min(1, f.wave[i])) * 0.5 + 0.5) * 255);
    }
    gl.useProgram(this.scene.handle);
    gl.viewport(0, 0, this.width, this.height);
    this.bind(this.scene, 'audio', this.audioTexture, 0);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1024, 2, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.samples);
    this.bind(this.scene, 'history', this.targets[this.front].texture, 1);
    gl.uniform2f(this.uniform(this.scene, 'resolution'), this.width, this.height);
    gl.uniform1i(this.uniform(this.scene, 'mode'), this.mode);
    const moving = animate && !reduced && f.energy > 0.006;
    const values = {
      time: this.motion.time,
      morph: this.motion.morph,
      colorPhase: this.motion.color,
      travel: this.motion.travel,
      turn: this.motion.turn,
      waveGain: Math.min(12, 0.18 / Math.max(0.015, f.rawRms)),
      bass: f.bass,
      mid: f.mid,
      treble: f.treble,
      energy: f.energy,
      rms: f.rms,
      beat: reduced ? 0 : f.beat,
      bassSlow: f.bassSlow,
      midSlow: f.midSlow,
      trebleSlow: f.trebleSlow,
      bassHit: reduced ? 0 : f.bassHit,
      midHit: reduced ? 0 : f.midHit,
      trebleHit: reduced ? 0 : f.trebleHit,
      flux: f.flux,
      centroid: f.centroid,
      sustain: f.sustain,
      intensity,
      persistence:
        moving && this.historyReady && (this.mode < 12 || this.mode >= 15)
          ? Math.exp(
              -dt /
                (this.mode === 15
                  ? 0.17
                  : this.mode === 16
                    ? 0.055
                    : this.mode === 17
                      ? 0.1
                      : 0.16),
            )
          : 0,
      drift: moving ? dt : 0,
    };
    for (const [key, value] of Object.entries(values))
      gl.uniform1f(this.uniform(this.scene, key), value);
    this.front = 1 - this.front;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[this.front].framebuffer);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.present();
    this.hasFrame = true;
    this.historyReady = true;
  }

  private present() {
    const gl = this.gl;
    const bw = Math.max(1, Math.ceil(this.width / 4)),
      bh = Math.max(1, Math.ceil(this.height / 4));
    gl.viewport(0, 0, bw, bh);
    gl.useProgram(this.bloom.handle);
    for (let pass = 0; pass < 3; pass++) {
      const target = this.bloomTargets[pass === 1 ? 1 : 0];
      const source =
        pass === 0
          ? this.targets[this.front].texture
          : this.bloomTargets[pass === 1 ? 0 : 1].texture;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      this.bind(this.bloom, 'source', source, 0);
      gl.uniform2f(this.uniform(this.bloom, 'texel'), 1 / bw, 1 / bh);
      gl.uniform2f(this.uniform(this.bloom, 'direction'), pass === 1 ? 1 : 0, pass === 2 ? 1 : 0);
      gl.uniform1f(this.uniform(this.bloom, 'extract'), pass === 0 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.composite.handle);
    this.bind(this.composite, 'scene', this.targets[this.front].texture, 0);
    this.bind(this.composite, 'previous', this.previous, 1);
    this.bind(this.composite, 'glow', this.bloomTargets[0].texture, 2);
    gl.uniform2f(this.uniform(this.composite, 'texel'), 1 / this.width, 1 / this.height);
    const t = this.transition;
    gl.uniform1f(this.uniform(this.composite, 'transition'), t * t * (3 - 2 * t));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(releaseContext = false) {
    const gl = this.gl;
    [...this.targets, ...this.bloomTargets].forEach((t) => gl.deleteFramebuffer(t.framebuffer));
    this.textures.forEach((t) => gl.deleteTexture(t));
    this.programs.forEach((p) => gl.deleteProgram(p.handle));
    gl.deleteBuffer(this.buffer);
    if (releaseContext) gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
