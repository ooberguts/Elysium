//! An active radio session prevents idle system sleep, while allowing display
//! sleep and locking. The assertion belongs to the session's worker thread.
pub struct Awake {
    #[cfg(target_os = "macos")]
    child: Option<std::process::Child>,
    // Windows execution state is thread-local: do not move this guard.
    _thread: std::marker::PhantomData<std::rc::Rc<()>>,
}
#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn SetThreadExecutionState(flags: u32) -> u32;
}
impl Awake {
    pub fn new() -> Self {
        #[cfg(windows)]
        unsafe {
            SetThreadExecutionState(0x80000001);
        }
        Self {
            #[cfg(target_os = "macos")]
            child: std::process::Command::new("/usr/bin/caffeinate")
                .args(["-i", "-w", &std::process::id().to_string()])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .ok(),
            _thread: std::marker::PhantomData,
        }
    }
}
impl Drop for Awake {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        #[cfg(windows)]
        unsafe {
            SetThreadExecutionState(0x80000000);
        }
    }
}
