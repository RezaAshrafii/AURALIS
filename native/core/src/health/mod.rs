#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComponentState {
    Unknown,
    Ready,
    Capturing,
    Healthy,
    Degraded,
    Failed,
    Stopped,
}

pub const CRITICAL_PHASE2_COMPONENTS: [&str; 4] =
    ["CaptureMic", "CaptureSystem", "SpoolWriter", "Storage"];
