// Original Elysium shaders. No external presets or textures are required.
export const vertexShader = `
attribute vec2 position;
varying vec2 uv;
void main() { uv = position * .5 + .5; gl_Position = vec4(position, 0., 1.); }
`;

export const sceneShader = `
precision highp float;
varying vec2 uv;
uniform vec2 resolution;
uniform sampler2D audio;
uniform sampler2D history;
uniform float time, bass, mid, treble, energy, rms, beat, intensity, persistence, drift;
uniform float bassSlow, midSlow, trebleSlow, bassHit, midHit, trebleHit, flux, centroid, sustain;
uniform float morph, colorPhase, travel, turn, waveGain;
uniform int mode;
const float PI = 3.14159265359;
const float TAU = 6.28318530718;
mat2 rot(float a) { float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
}
float fbm(vec2 p) {
  float a=.5, n=0.;
  for(int i=0;i<4;i++) { n+=a*noise(p); p=rot(.53)*p*2.03+3.7; a*=.5; }
  return n;
}
vec3 palette(float t) { return .52+.48*cos(TAU*(t+vec3(.0,.32,.64))); }
float band(float x) { return texture2D(audio,vec2(clamp(x,.008,.992),.25)).r; }
float wave(float x) { return texture2D(audio,vec2(clamp(x,.001,.999),.75)).r*2.-1.; }
float line(float d,float w) { return w/max(w,abs(d)); }
float filament(float d,float w) { float v=line(d,w); return v*v; }
vec3 stars(vec2 p,float t) {
  vec3 c=vec3(0);
  for(int i=0;i<3;i++) {
    float z=float(i)+1.; vec2 q=p*(25.+z*22.)+vec2(t*.12*z,0);
    vec2 id=floor(q), g=fract(q)-.5;
    float seed=hash(id+z); float s=pow(max(0.,1.-length(g)*4.),9.);
    c+=vec3(.45,.65,1.)*s*step(.965,seed)*(.4+.6*sin(seed*95.+t+z)) /z;
  }
  return c;
}
vec3 ribbons(vec2 p,bool neon) {
  vec3 c=vec3(0); float t=time*.4;
  p*=rot(sin(t*.23)*.28 + beat*.06);
  p.y+=sin(p.x*2.-t*.4)*.16+sin(p.x*3.7+t*.3)*.1;
  p.x+=sin(p.y*4.+t*.3)*(.15+mid*.12);
  for(int i=0;i<9;i++) {
    float k=float(i), z=k/9., a=band(z);
    float y=sin(p.x*(neon?2.4:1.35)+t+k*.27)*(.28+sin(t*.7+k*.13)*.22+rms*.32);
    y+=cos(p.x*2.1-t*.8+k*.21)*.13 + (z-.5)*(.35+bass*.35+rms*.4);
    y+=wave(fract(p.x*.16+.5))*.24*(.3+a);
    float d=p.y-y;
    vec3 hue=neon?palette(z*.6+t*.035):palette(z*.4+.42+t*.028);
    c+=hue*(filament(d,.0025+a*.003)*1.5+line(d,.025)*.11)*( .45+a*.85);
    // A folded sheet with a lit ridge and translucent edges, rather than a line.
    float width=.025+a*.055+rms*.04;
    float sheet=exp(-pow(d/width,2.));
    float fold=.3+.7*pow(.5+.5*sin(p.x*3.4+t+k*.7),3.);
    float normal=clamp(d/width,-1.,1.);
    float sheen=pow(max(0.,1.-abs(normal+.35)),8.);
    c+=hue*sheet*(.2+fold*.4)+vec3(.6,.8,1.)*sheen*sheet*.045;
    c+=hue*exp(-abs(d)*18.)*.045;
  }
  if(neon) {
    vec2 q=p*rot(t*.13);
    for(int j=0;j<3;j++) {
      float k=float(j);
      q=abs(q)*rot(.65+t*.04)-vec2(.45,.2);
      q*=1.7;
      float fold=sin(q.x*5.+sin(q.y*4.+t)*2.+t+k);
      c+=palette(length(q)*.2+t*.05+k*.18)*filament(fold,.035+bass*.03)*(.16+rms*.1);
    }
  }
  c+=stars(p,time)*.6;
  c+=vec3(.09,.04,.17)*exp(-length(p)*2.);
  return c;
}
vec3 ocean(vec2 p) {
  vec3 c=vec3(.005,.014,.035); float t=time*.55;
  for(int i=0;i<24;i++) {
    float z=float(i)/24., a=band(z);
    float y=-.63+z*.95;
    y+=sin(p.x*(2.+z*3.)+t+z*7.)*(.025+z*.08+bass*.08+rms*.15);
    y+=sin(p.x*5.-t*.7+z*5.)*.028 + a*.11;
    float d=p.y-y;
    c+=mix(vec3(.02,.3,.8),vec3(.03,.95,.72),z)*(filament(d,.0014+z*.0018)+exp(-abs(d)*35.)*.06)*(.3+a);
  }
  c+=vec3(.03,.16,.25)*exp(-length((p-vec2(0,.08))*vec2(.7,2.))*3.);
  return c+stars(p,time)*.3;
}
vec3 terrain(vec2 p,bool matrix) {
  vec3 c=vec3(.004,.009,.018); float horizon=.12+rms*.06;
  float depth=1./max(.03,horizon-p.y), z=depth*.8+time*.45;
  float x=p.x*depth;
  float height=sin(x*.7+z*.6)*.22+sin(z*.85)*.35+band(fract(x*.025+.5))*(bass*.9+rms*1.5)+beat*.35;
  vec2 grid=vec2(x*1.5,(depth+height)*2.);
  vec2 cell=abs(fract(grid)-.5);
  float fade=smoothstep(.01,.18,horizon-p.y)*exp(-depth*.035);
  vec3 hue=matrix?vec3(.14,1.,.32):mix(vec3(.1,.24,1.),vec3(.1,.95,.92),clamp(depth*.08,0.,1.));
  float lines=matrix?max(filament(cell.x,.018),filament(cell.y,.025)):exp(-length(cell)*35.)*2.;
  c+=hue*lines*fade*(.5+energy);
  c+=hue*exp(-abs(p.y-horizon)*16.)*.09;
  c+=stars(p,time)*smoothstep(horizon,.4,p.y)*.6;
  return c;
}
// An organic fractal relief: mirrored inversion folds form thick, glossy
// surfaces. Bass opens the folds; mids deform the material; percussion lights it.
vec3 prism(vec2 p,bool bloom) {
  float t=time*.23, life=morph*.72, radius=length(p), angle=atan(p.y,p.x);
  // Interpolate folded coordinates, not finished images. The structures melt
  // into a different symmetry instead of swapping presets or rotating in place.
  float era=floor(life), blend=smoothstep(0.,1.,fract(life));
  float first=4.+mod(era*3.+(bloom?2.:1.),5.);
  float second=4.+mod((era+1.)*3.+(bloom?2.:1.),5.);
  angle+=t*.12+sin(radius*(2.4+sin(life*.7)) - t)*(.16+bass*.25);
  float a=abs(mod(angle+PI/first,TAU/first)-PI/first);
  float b=abs(mod(angle+PI/second,TAU/second)-PI/second);
  vec2 direction=mix(vec2(cos(a),sin(a)),vec2(cos(b),sin(b)),blend);
  vec2 q=direction*radius*(2.2-bass*.35-beat*.12);
  q*=1.+.13*sin(life*.93);
  vec3 c=pow(palette(radius*.25+t*.035),vec3(2.))* .07;
  for(int i=0;i<5;i++) {
    float k=float(i);
    vec2 fold=vec2(.59+.15*sin(life*1.1+k*.63),.31+.12*cos(life*.87-k*.47));
    q=abs(q)*rot(.55+sin(life*.8+k)*.3)-fold-vec2(bass*.12+bassHit*.025,mid*.16+band(k*.18)*.07);
    q=q/clamp(dot(q,q),.30+.08*sin(life*.73+k),1.65+.25*cos(life*.61));
    q+=vec2(sin(q.y*2.+t),cos(q.x*2.-t))*(.07+.1*(.5+.5*sin(life+k)));
    // Rounded cells grow lobes and flatten into soft facets, then open again.
    float rounded=length(q);
    float faceted=pow(pow(abs(q.x),4.)+pow(abs(q.y),4.),.25);
    float curvature=.5+.5*sin(life*.9+k*.71);
    float form=mix(rounded,faceted,curvature);
    form+=sin(atan(q.y,q.x)*3.+life*.7)*sin(life*.53+k)*.12;
    float d=form-(.67+sin(life*.8+k)*.19);
    float body=exp(-d*d*(bloom?6.:11.));
    float ridge=sin(d*5.);
    vec3 n=normalize(vec3(normalize(q+vec2(.0001))*ridge,sqrt(max(.01,1.-ridge*ridge))));
    vec3 light=normalize(vec3(-.4,.7,1.));
    float diffuse=.2+.8*max(0.,dot(n,light));
    float specular=pow(max(0.,dot(n,normalize(vec3(-.3,.5,1.7)))),24.);
    vec3 hue=pow(palette(radius*.3+k*.055+colorPhase*.3+d*.1+(bloom?.28:0.)),vec3(2.));
    float vein=.88+.12*sin(q.x*18.+sin(q.y*12.)*2.);
    vec3 material=hue*diffuse*vein*(.7+rms*.45)+vec3(.85,.9,1.)*specular*.18;
    c=mix(c,material,body*.8);
    c+=hue*exp(-abs(d)*18.)*.035;
  }
  return c;
}
vec3 cosmos(vec2 p,bool dust) {
  vec3 c=vec3(0); float t=time*.15;
  vec2 q=p*rot(t*.25)/(1.+rms*.35+beat*.08); q.y*=dust?1.5:2.5;
  float r=length(q), a=atan(q.y,q.x);
  float spiral=sin(a*3.+r*13.-t*5.);
  float nebula=fbm(p*3.+vec2(t,-t))*.6;
  c+=mix(vec3(.1,.15,.65),vec3(.7,.12,.4),nebula+sin(a+t)*.2)*exp(-r*2.4)*(.2+nebula)*(.4+energy);
  c+=palette(r*.25+t*.05+.5)*pow(max(0.,spiral),12.)*exp(-r*2.)*.25;
  for(int i=0;i<5;i++) {
    float k=float(i), depth=fract(k*.21+t*.06);
    vec2 s=p*rot(t*(.1+k*.05))*(18.+k*12.)*(.8+depth*.3);
    vec2 id=floor(s), g=fract(s)-.5;
    float seed=hash(id+k*7.), sparkle=pow(max(0.,1.-length(g)*3.),12.);
    float arm=.5+.5*sin(atan(p.y,p.x)*3.+length(p)*14.-t*5.);
    c+=palette(seed*.4+.5)*sparkle*step(dust?.8:.9,seed)*(.3+arm)*(.6+treble+rms*2.)*1.3;
  }
  float core=exp(-length(p)*18.);
  c+=vec3(.7,.85,1.)*core*(.5+bass);
  if(!dust) {
    float ring=abs(length(p*rot(.4)*vec2(1.,2.6))-.38-bass*.035);
    c+=vec3(.35,.6,1.)*filament(ring,.004)*.7;
  }
  return c;
}
// Signed-distance surfaces are ray marched and lit in world space.
float sculpture(vec3 p, bool liquid) {
  p.xz*=rot(time*.16); p.xy*=rot(sin(time*.12)*.3);
  float ripple=sin(p.x*5.+time*.8)*sin(p.y*4.-time*.6)*sin(p.z*5.+time*.4);
  float fine=sin(p.x*11.-time)*sin(p.y*9.+time*.5)*sin(p.z*10.);
  return length(p)-(.78+bass*.20+rms*.30+beat*.09)-ripple*(liquid?.16:.11)-fine*.025;
}
vec3 plasma(vec2 p,bool liquid) {
  float t=time*.25;
  vec3 ro=vec3(0.,0.,3.3), rd=normalize(vec3(p*2.45,-2.6));
  float distance=0., glow=0.; vec3 point=ro;
  for(int i=0;i<44;i++) {
    point=ro+rd*distance;
    float d=sculpture(point,liquid);
    glow+=.0025/(.04+abs(d));
    if(d<.002 || distance>6.) break;
    distance+=d*.72;
  }
  vec3 c=vec3(.005,.014,.018);
  vec3 emerald=liquid?vec3(.05,.63,.48):vec3(.22,.7,.08);
  float nebula=fbm(p*3.+t*.2);
  c+=emerald*nebula*.055;
  if(distance<6.) {
    vec2 e=vec2(.003,0.);
    vec3 n=normalize(vec3(
      sculpture(point+e.xyy,liquid)-sculpture(point-e.xyy,liquid),
      sculpture(point+e.yxy,liquid)-sculpture(point-e.yxy,liquid),
      sculpture(point+e.yyx,liquid)-sculpture(point-e.yyx,liquid)));
    vec3 light=normalize(vec3(-2.,3.,3.));
    float diffuse=max(0.,dot(n,light));
    float specular=pow(max(0.,dot(reflect(-light,n),-rd)),liquid?55.:24.);
    float fresnel=pow(1.-max(0.,dot(n,-rd)),3.);
    vec3 q=point; q.xz*=rot(time*.16);
    float veins=sin(q.x*12.+sin(q.y*9.+t)*2.+q.z*7.-t*3.);
    float emission=pow(.5+.5*veins,16.)*(.15+bass*.7);
    vec3 surface=mix(emerald*.06,emerald,diffuse*.65);
    c=surface+vec3(.65,.95,.8)*specular*.85;
    c+=mix(vec3(.03,.4,.6),emerald,fresnel)*fresnel*.85;
    c+=emerald*emission*(liquid?.4:1.);
    c+=vec3(.05,.15,.16)*max(0.,dot(n,normalize(vec3(2.,-1.,1.))));
  }
  c+=emerald*min(.15,glow*.045);
  // A tilted orbital plane and small suspended motes establish spatial scale.
  vec2 ring=p*rot(-.32); ring.y*=3.6;
  float ringD=abs(length(ring)-.50-bass*.025-rms*.08-beat*.02);
  c+=emerald*filament(ringD,.0018)*(.25+smoothstep(-.1,.1,-p.y)*.3);
  c+=stars(p,time)*.25;
  return c;
}
// A continuous cylindrical flight, with musical changes to the lens, twist,
// wall relief, light rails, and travelling pulse rings.
vec3 tunnel(vec2 p) {
  float t=time*.55;
  p+=vec2(sin(t*.3),cos(t*.27))*.035;
  float r=max(.025,length(p)), angle=atan(p.y,p.x);
  float depth=.48/r;
  float z=depth-t+bass*.55+beat*.22;
  float twist=angle+depth*.22+sin(z*.65+t)*(.12+bass*.18)+t*.16;
  twist+=wave(fract(angle/TAU+.5))*(.2+bass*.25);
  vec2 wall=vec2(twist*3.82,z*1.5);
  wall+=vec2(sin(z*1.3+angle*3.),sin(twist*4.+t))*(.18+mid*.28);
  vec2 tile=abs(fract(wall)-.5);
  float rails=filament(tile.x,.012+treble*.014);
  float rings=filament(tile.y,.012+bass*.022+beat*.024);
  float cell=pow(max(0.,1.-length(tile)*1.5),5.);
  vec3 hue=palette(z*.075+twist*.11+t*.05);
  vec3 other=palette(z*.075+twist*.11+t*.05+.23);
  vec3 c=hue*(rails*.55+rings*.5+cell*(.12+rms*.2));
  c+=other*filament(sin(twist*6.+z*.75),.035)*(.15+treble*.4);
  float pulse=sin(z*2.8+angle*2.+bass*2.2+beat*.7);
  c+=palette(z*.09+t*.1)*filament(pulse,.025+bass*.04)*(.18+bass*.4);
  c*=smoothstep(.02,.13,r)*(.65+exp(-r*1.8)*.4);
  c+=palette(t*.06+angle/TAU)*exp(-r*14.)*(.3+bass*.35);
  return c;
}

// Analytic curl of a scalar potential: opposing vortices transport the previous
// frame without the sinks produced by independent random X/Y displacements.
vec2 currentField(vec2 p) {
  float a=dot(p,vec2(1.7,2.3))+morph*.8;
  float b=dot(p,vec2(-2.8,1.3))-travel*.65;
  float c=dot(p,vec2(3.6,-2.1))+morph*.43;
  return vec2(2.3,-1.7)*cos(a)*.24 + vec2(1.3,2.8)*cos(b)*.17 + vec2(-2.1,-3.6)*cos(c)*.07;
}
vec3 jewel(float x) {
  vec3 base=.48+.47*cos(TAU*(x+vec3(.04,.29,.58)));
  return pow(max(base,vec3(0.)),vec3(1.45));
}
vec3 current(vec2 p) {
  vec2 q=rot(turn*.3)*p*(2.4-bass*.35);
  q+=currentField(q)*(.5+midSlow*.65);
  vec2 bend=vec2(fbm(q+vec2(morph*.22,4.7)),fbm(q+vec2(5.1,-morph*.18)));
  q+=(bend-.5)*(1.7+mid*.75)+currentField(q*1.4)*.25;
  float n=fbm(q*1.7+vec2(travel*.18,-morph*.13));
  float marble=n*8.+q.x*.7+q.y*.4 + sin(q.y*1.4+morph)*.65;
  marble+=wave(uv.x)*waveGain*(.07+mid*.10);
  float vein=sin(marble*3.+colorPhase*2.);
  float body=.5+.5*sin(marble+colorPhase*TAU);
  vec3 hue=jewel(body*.52+n*.30+colorPhase*.38);
  vec2 tangent=currentField(q);
  vec3 normal=normalize(vec3(tangent*(.6+bassSlow*.4),.8));
  float light=.32+.68*max(0.,dot(normal,normalize(vec3(-.4,.65,1.))));
  vec3 c=hue*(.24+light*.72);
  float ridge=exp(-abs(vein)*28.);
  c+=jewel(body*.52+.18+colorPhase*.38)*ridge*(.14+treble*.25+trebleHit*.32);
  c+=vec3(.5,.8,.85)*pow(max(0.,dot(normal,normalize(vec3(-.3,.5,1.4)))),20.)*(.1+midHit*.12);
  c*=.60+.40*smoothstep(-.8,.7,vein);
  return c;
}
// Animated Julia orbits and orbit traps create connected branches and spirals.
// Smooth escape counts avoid iteration bands, with pixel-sized antialiasing.
vec3 garden(vec2 p) {
  vec2 q=p*rot(turn*.25+sin(morph*.3)*.22);
  q+=vec2(sin(q.y*2.+morph),cos(q.x*1.7-morph))*(.08+midSlow*.11);
  vec2 z=q*(1.85-bass*.24), derivative=vec2(1.,0.);
  vec2 seed=vec2(-.745+.045*sin(morph*.61)+midSlow*.018,.186+.075*cos(morph*.43)+bassHit*.006);
  float trap=10., petal=10., count=0., radius=0.;
  for(int i=0;i<36;i++) {
    derivative=2.*vec2(z.x*derivative.x-z.y*derivative.y,z.x*derivative.y+z.y*derivative.x);
    z=vec2(z.x*z.x-z.y*z.y,2.*z.x*z.y)+seed;
    radius=dot(z,z); count=float(i);
    trap=min(trap,abs(z.y+sin(z.x*2.+morph*.6)*.18));
    petal=min(petal,abs(length(z)-(.55+mid*.12)));
    if(radius>64.) break;
  }
  float escaped=step(64.,radius);
  float continuous=count+1.-log2(max(1.,log2(max(radius,1.01))));
  float distance=.5*sqrt(max(radius,.0001))*log(max(radius,1.01))/max(length(derivative),.001);
  float edge=exp(-max(0.,distance)*25.);
  float aa=1.5/resolution.y;
  float fibers=exp(-trap*(28.+trebleSlow*22.));
  float halo=exp(-petal*16.);
  vec3 hue=jewel(continuous*.045+colorPhase*.44+trap*.45);
  vec3 c=hue*(.04+edge*.16+fibers*.55)*(1.-escaped*.2);
  c+=jewel(continuous*.045+colorPhase*.44+.24)*halo*(.17+mid*.18);
  c+=vec3(.4,.75,.9)*filament(distance,aa*2.)*escaped*(.2+trebleHit*.3);
  c+=jewel(length(q)*.2+colorPhase)*.035;
  return c;
}
vec3 aurora(vec2 p) {
  vec3 c=vec3(.004,.008,.025);
  vec2 q=p*rot(sin(morph*.35)*.24+turn*.25);
  float light=0.;
  for(int i=0;i<7;i++) {
    float k=float(i), depth=k/6.;
    float x=q.x*(1.+depth*.65);
    float shape=sin(x*(1.6+midSlow*.7)+morph*.6+k*.58)*(.24+bass*.12);
    shape+=sin(x*3.2-morph*.3+k*.36)*.13;
    shape+=sin(x*5.7+morph*.2+k*.2)*.035;
    shape+=wave(fract(x*.15+.5))*waveGain*(.012+band(depth)*.025);
    float d=q.y-shape-(depth-.5)*(.9+bassSlow*.3);
    float width=.038+mid*.028+depth*.012;
    float sheet=exp(-pow(d/width,2.));
    float pleat=.6+.4*sin(x*36.+sin(x*6.-morph)*5.+k*.9);
    float threads=.78+.22*sin(x*145.+sin(x*17.-morph)*4.+k*2.1);
    vec3 hue=jewel(depth*.33+colorPhase*.5+x*.055);
    float rim=exp(-abs(d+width*.55)*90.);
    vec3 layer=hue*sheet*(.45+pleat*.45+midHit*.12)*threads;
    layer+=mix(hue,vec3(.5,.85,.8),.28)*rim*(.14+treble*.28+trebleHit*.2);
    c=c*(1.-sheet*.30)+layer;
    light+=sheet*.04;
  }
  c+=jewel(colorPhase*.5+.1)*exp(-length(q)*1.7)*.06;
  c+=stars(p,travel)*(.25+trebleHit*.3)*(1.-min(1.,light));
  return c;
}
vec3 spectrum(vec2 p) {
  vec2 q=uv; float index=floor(q.x*64.);
  float a=band((index+.5)/64.);
  float bar=step(abs(fract(q.x*64.)-.5),.35);
  float base=.28, height=a*.55;
  float fill=step(base,q.y)*step(q.y,base+height);
  float reflection=step(q.y,base)*exp((q.y-base)*15.)*step(base-q.y,height)*.25;
  vec3 c=palette(q.x*.35+.45)*bar*(fill+reflection)*(.35+q.y*.8);
  c+=vec3(.13,.24,.28)*filament(q.y-base,.001);
  vec2 grid=abs(fract(vec2(q.x*8.,(q.y-base)*10.))-.5);
  c+=vec3(.014,.025,.03)*max(step(grid.x,.012),step(grid.y,.012));
  return c;
}
vec3 scope(vec2 p) {
  vec2 grid=abs(fract(p*vec2(10.,10.))-.5);
  vec3 c=vec3(.015,.035,.04)*max(step(grid.x,.015),step(grid.y,.015));
  float w=wave(uv.x)*.35;
  c+=vec3(.2,.95,.8)*(filament(p.y-w,.002)+exp(-abs(p.y-w)*40.)*.16);
  c+=vec3(.05,.16,.13)*filament(p.y,.001);
  return c;
}
vec3 ambient(vec2 p) {
  float t=time*.2;
  float n=fbm(p*2.+vec2(t*.3,-t*.4));
  vec3 c=vec3(0);
  for(int i=0;i<4;i++) {
    float k=float(i), a=t+k*1.57;
    vec2 center=vec2(sin(a)*(.3+rms*.25),cos(a*.7)*(.16+bass*.18));
    c+=palette(k*.2+.5)*exp(-length(p-center)*(3.+n*3.))*(.15+band(k*.22)*.3);
  }
  return c;
}
void main() {
  vec2 p=(uv-.5)*vec2(resolution.x/resolution.y,1.);
  vec3 c=vec3(0);
  if(mode==0) c=prism(p,false);
  else if(mode==1) c=ocean(p);
  else if(mode==2) c=terrain(p,false);
  else if(mode==3) c=ribbons(p,false);
  else if(mode==4) c=cosmos(p,false);
  else if(mode==5) c=cosmos(p,true);
  else if(mode==6) c=plasma(p,false);
  else if(mode==7) c=plasma(p,true);
  else if(mode==8) c=terrain(p,true);
  else if(mode==9) c=ribbons(p,true);
  else if(mode==10) c=tunnel(p);
  else if(mode==11) c=prism(p,true);
  else if(mode==12) c=spectrum(p);
  else if(mode==13) c=scope(p);
  else if(mode==14) c=ambient(p);
  else if(mode==15) c=current(p);
  else if(mode==16) c=garden(p);
  else c=aurora(p);
  // Time-based feedback avoids frame-rate-dependent trails. Never warp in reduced motion.
  float psychedelic=(mode==0 || mode==9 || mode==10 || mode==11)?1.:0.;
  vec2 centered=uv-.5;
  vec2 back=centered*rot(drift*(.025+bass*.1))*(1.-drift*(.025+beat*.12))+.5;
  back+=vec2(sin(centered.y*9.+time*.3),cos(centered.x*8.-time*.25))*drift*(.007+mid*.012)*psychedelic;
  if(mode>=15) {
    vec2 field=currentField(p*2.1);
    float flow=mode==15?1.:(mode==16?.08:.24);
    back=uv-field*drift*(.026+midSlow*.022)*flow;
    back+=centered*drift*(-.015-bassHit*.065)*flow;
  }
  vec3 trail=texture2D(history,back).rgb;
  float edge=step(0.,back.x)*step(back.x,1.)*step(0.,back.y)*step(back.y,1.);
  c*=intensity*(.8+energy*.35+beat*.07);
  // Bounded light accumulation prevents feedback from bleaching every color.
  c=c/(1.+max(c-vec3(.75),vec3(0.)));
  if(mode>=15) c=mix(c,trail,persistence*edge);
  else c=mix(c,max(c,trail*.985),persistence*edge);
  gl_FragColor=vec4(clamp(c,0.,1.),1.);
}
`;

export const bloomShader = `
precision highp float;
varying vec2 uv;
uniform sampler2D source;
uniform vec2 texel, direction;
uniform float extract;
void main() {
  vec3 c;
  if(extract>.5) {
    c=(texture2D(source,uv+texel*vec2(-.25,-.25)).rgb+texture2D(source,uv+texel*vec2(.25,-.25)).rgb
      +texture2D(source,uv+texel*vec2(-.25,.25)).rgb+texture2D(source,uv+texel*vec2(.25,.25)).rgb)*.25;
    float brightness=max(c.r,max(c.g,c.b));
    c*=smoothstep(.28,.8,brightness)*.6;
  } else {
    vec2 d=texel*direction;
    c=texture2D(source,uv).rgb*.227027;
    c+=(texture2D(source,uv+d*1.384615).rgb+texture2D(source,uv-d*1.384615).rgb)*.316216;
    c+=(texture2D(source,uv+d*3.230769).rgb+texture2D(source,uv-d*3.230769).rgb)*.070270;
  }
  gl_FragColor=vec4(c,1.);
}
`;

export const compositeShader = `
precision highp float;
varying vec2 uv;
uniform sampler2D scene, previous, glow;
uniform vec2 texel;
uniform float transition;
void main() {
  vec3 c=texture2D(scene,uv).rgb;
  c+=texture2D(glow,uv).rgb*.65;
  c=1.-exp(-c*1.7);
  c=pow(max(c,vec3(0)),vec3(.92));
  float vignette=1.-.25*pow(length((uv-.5)*1.3),2.);
  c*=vignette;
  // Sub-LSB static dithering reduces visible bands without animated grain.
  c+=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.;
  c=mix(texture2D(previous,uv).rgb,c,transition);
  gl_FragColor=vec4(c,1.);
}
`;
