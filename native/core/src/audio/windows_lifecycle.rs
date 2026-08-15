use std::{
    ffi::c_void,
    ptr,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender, TrySendError},
    },
    thread::{self, JoinHandle},
};

use windows::{
    Win32::{
        Foundation::{ERROR_SUCCESS, HANDLE, PROPERTYKEY},
        Media::Audio::{
            DEVICE_STATE, DEVICE_STATE_ACTIVE, EDataFlow, ERole, IMMDeviceEnumerator,
            IMMNotificationClient, IMMNotificationClient_Impl, MMDeviceEnumerator, eCapture,
            eCommunications, eMultimedia, eRender,
        },
        System::{
            Com::{
                CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
            },
            Power::{
                DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS, HPOWERNOTIFY,
                PowerRegisterSuspendResumeNotification, PowerUnregisterSuspendResumeNotification,
            },
        },
        UI::WindowsAndMessaging::{DEVICE_NOTIFY_CALLBACK, PBT_APMRESUMEAUTOMATIC, PBT_APMSUSPEND},
    },
    core::{PCWSTR, implement},
};

use crate::domain::{ledger::SourceKind, ports::CoreError};

use super::lifecycle::DeviceLifecycleEvent;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioDeviceFlow {
    Capture,
    Render,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioDeviceRole {
    Communications,
    Multimedia,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowsLifecycleSignal {
    DeviceStateChanged {
        device_id: String,
        active: bool,
        raw_state: u32,
    },
    DeviceAdded {
        device_id: String,
    },
    DeviceRemoved {
        device_id: String,
    },
    DefaultDeviceChanged {
        flow: AudioDeviceFlow,
        role: AudioDeviceRole,
        device_id: Option<String>,
    },
    Suspend,
    Resume,
}

impl WindowsLifecycleSignal {
    pub fn to_device_event(
        &self,
        source_kind: SourceKind,
        active_device_id: &str,
    ) -> Option<DeviceLifecycleEvent> {
        match self {
            Self::DeviceStateChanged {
                device_id,
                active: false,
                ..
            } if device_id == active_device_id => Some(DeviceLifecycleEvent::DeviceInvalidated {
                device_id: device_id.clone(),
            }),
            Self::DeviceStateChanged {
                device_id,
                active: true,
                ..
            }
            | Self::DeviceAdded { device_id }
                if device_id == active_device_id =>
            {
                Some(DeviceLifecycleEvent::ReconnectDetected {
                    device_id: device_id.clone(),
                })
            }
            Self::DeviceRemoved { device_id } if device_id == active_device_id => {
                Some(DeviceLifecycleEvent::DeviceUnplugged {
                    device_id: device_id.clone(),
                })
            }
            Self::DefaultDeviceChanged {
                flow,
                role,
                device_id: Some(device_id),
            } if endpoint_matches_source(*flow, *role, source_kind) => {
                Some(DeviceLifecycleEvent::DefaultDeviceChanged {
                    device_id: device_id.clone(),
                })
            }
            Self::DefaultDeviceChanged {
                flow,
                role,
                device_id: None,
            } if endpoint_matches_source(*flow, *role, source_kind) => {
                Some(DeviceLifecycleEvent::DeviceUnplugged {
                    device_id: active_device_id.into(),
                })
            }
            Self::Suspend => Some(DeviceLifecycleEvent::Suspend),
            Self::Resume => Some(DeviceLifecycleEvent::Resume),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LifecycleMonitorStats {
    pub emitted: u64,
    pub dropped: u64,
}

#[derive(Default)]
struct LifecycleCounters {
    emitted: AtomicU64,
    dropped: AtomicU64,
}

struct SignalEmitter {
    sender: SyncSender<WindowsLifecycleSignal>,
    counters: Arc<LifecycleCounters>,
}

impl Clone for SignalEmitter {
    fn clone(&self) -> Self {
        Self {
            sender: self.sender.clone(),
            counters: Arc::clone(&self.counters),
        }
    }
}

impl SignalEmitter {
    fn emit(&self, signal: WindowsLifecycleSignal) {
        match self.sender.try_send(signal) {
            Ok(()) => {
                self.counters.emitted.fetch_add(1, Ordering::Relaxed);
            }
            Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) => {
                self.counters.dropped.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
}

pub struct WindowsLifecycleMonitor {
    receiver: Receiver<WindowsLifecycleSignal>,
    counters: Arc<LifecycleCounters>,
    stop_sender: Option<mpsc::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl WindowsLifecycleMonitor {
    pub fn start(capacity: usize) -> Result<Self, CoreError> {
        if capacity == 0 {
            return Err(CoreError::InvalidState(
                "lifecycle monitor capacity must be non-zero".into(),
            ));
        }
        let (signal_sender, receiver) = mpsc::sync_channel(capacity);
        let (stop_sender, stop_receiver) = mpsc::channel();
        let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
        let counters = Arc::new(LifecycleCounters::default());
        let thread_counters = Arc::clone(&counters);
        let thread = thread::Builder::new()
            .name("auralis-windows-lifecycle".into())
            .spawn(move || {
                let emitter = SignalEmitter {
                    sender: signal_sender,
                    counters: thread_counters,
                };
                match RegisteredNotifications::new(emitter) {
                    Ok(registration) => {
                        let _ = ready_sender.send(Ok(()));
                        let _ = stop_receiver.recv();
                        drop(registration);
                    }
                    Err(error) => {
                        let _ = ready_sender.send(Err(error));
                    }
                }
            })
            .map_err(|error| {
                CoreError::Capture(format!("failed to spawn lifecycle monitor: {error}"))
            })?;
        match ready_receiver.recv() {
            Ok(Ok(())) => Ok(Self {
                receiver,
                counters,
                stop_sender: Some(stop_sender),
                thread: Some(thread),
            }),
            Ok(Err(error)) => {
                let _ = thread.join();
                Err(CoreError::Capture(error))
            }
            Err(error) => {
                let _ = thread.join();
                Err(CoreError::Capture(format!(
                    "lifecycle monitor startup handshake failed: {error}"
                )))
            }
        }
    }

    pub fn recv(&self) -> Result<WindowsLifecycleSignal, mpsc::RecvError> {
        self.receiver.recv()
    }

    pub fn try_recv(&self) -> Result<WindowsLifecycleSignal, mpsc::TryRecvError> {
        self.receiver.try_recv()
    }

    pub fn recv_timeout(
        &self,
        timeout: std::time::Duration,
    ) -> Result<WindowsLifecycleSignal, mpsc::RecvTimeoutError> {
        self.receiver.recv_timeout(timeout)
    }

    pub fn stats(&self) -> LifecycleMonitorStats {
        LifecycleMonitorStats {
            emitted: self.counters.emitted.load(Ordering::Relaxed),
            dropped: self.counters.dropped.load(Ordering::Relaxed),
        }
    }
}

impl Drop for WindowsLifecycleMonitor {
    fn drop(&mut self) {
        if let Some(sender) = self.stop_sender.take() {
            let _ = sender.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

struct RegisteredNotifications {
    enumerator: IMMDeviceEnumerator,
    client: IMMNotificationClient,
    power: PowerRegistration,
    _apartment: ComApartment,
}

impl RegisteredNotifications {
    fn new(emitter: SignalEmitter) -> Result<Self, String> {
        let apartment = ComApartment::initialize()?;
        let enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(win_error)? };
        let client: IMMNotificationClient = NotificationClient {
            emitter: emitter.clone(),
        }
        .into();
        unsafe {
            enumerator
                .RegisterEndpointNotificationCallback(&client)
                .map_err(win_error)?;
        }
        let power = match PowerRegistration::new(emitter) {
            Ok(power) => power,
            Err(error) => {
                let _ = unsafe { enumerator.UnregisterEndpointNotificationCallback(&client) };
                return Err(error);
            }
        };
        Ok(Self {
            enumerator,
            client,
            power,
            _apartment: apartment,
        })
    }
}

impl Drop for RegisteredNotifications {
    fn drop(&mut self) {
        let _ = &self.power;
        let _ = unsafe {
            self.enumerator
                .UnregisterEndpointNotificationCallback(&self.client)
        };
    }
}

#[implement(IMMNotificationClient)]
struct NotificationClient {
    emitter: SignalEmitter,
}

impl IMMNotificationClient_Impl for NotificationClient_Impl {
    fn OnDeviceStateChanged(
        &self,
        device_id: &PCWSTR,
        new_state: DEVICE_STATE,
    ) -> windows::core::Result<()> {
        self.emitter
            .emit(WindowsLifecycleSignal::DeviceStateChanged {
                device_id: pcwstr_to_string(device_id),
                active: new_state == DEVICE_STATE_ACTIVE,
                raw_state: new_state.0,
            });
        Ok(())
    }

    fn OnDeviceAdded(&self, device_id: &PCWSTR) -> windows::core::Result<()> {
        self.emitter.emit(WindowsLifecycleSignal::DeviceAdded {
            device_id: pcwstr_to_string(device_id),
        });
        Ok(())
    }

    fn OnDeviceRemoved(&self, device_id: &PCWSTR) -> windows::core::Result<()> {
        self.emitter.emit(WindowsLifecycleSignal::DeviceRemoved {
            device_id: pcwstr_to_string(device_id),
        });
        Ok(())
    }

    fn OnDefaultDeviceChanged(
        &self,
        flow: EDataFlow,
        role: ERole,
        device_id: &PCWSTR,
    ) -> windows::core::Result<()> {
        let flow = if flow == eCapture {
            AudioDeviceFlow::Capture
        } else if flow == eRender {
            AudioDeviceFlow::Render
        } else {
            AudioDeviceFlow::Other
        };
        let role = if role == eCommunications {
            AudioDeviceRole::Communications
        } else if role == eMultimedia {
            AudioDeviceRole::Multimedia
        } else {
            AudioDeviceRole::Other
        };
        let device_id = (!device_id.is_null()).then(|| pcwstr_to_string(device_id));
        self.emitter
            .emit(WindowsLifecycleSignal::DefaultDeviceChanged {
                flow,
                role,
                device_id,
            });
        Ok(())
    }

    fn OnPropertyValueChanged(
        &self,
        _device_id: &PCWSTR,
        _key: &PROPERTYKEY,
    ) -> windows::core::Result<()> {
        Ok(())
    }
}

struct PowerCallbackContext {
    emitter: SignalEmitter,
}

struct PowerRegistration {
    handle: HPOWERNOTIFY,
    _context: Box<PowerCallbackContext>,
}

impl PowerRegistration {
    fn new(emitter: SignalEmitter) -> Result<Self, String> {
        let mut context = Box::new(PowerCallbackContext { emitter });
        let parameters = DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(power_callback),
            Context: (&mut *context as *mut PowerCallbackContext).cast(),
        };
        let mut raw_handle = ptr::null_mut();
        let recipient = HANDLE(
            (&parameters as *const DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS)
                .cast_mut()
                .cast(),
        );
        let result = unsafe {
            PowerRegisterSuspendResumeNotification(
                DEVICE_NOTIFY_CALLBACK,
                recipient,
                &mut raw_handle,
            )
        };
        if result != ERROR_SUCCESS {
            return Err(format!(
                "PowerRegisterSuspendResumeNotification failed: {}",
                result.0
            ));
        }
        Ok(Self {
            handle: HPOWERNOTIFY(raw_handle as isize),
            _context: context,
        })
    }
}

impl Drop for PowerRegistration {
    fn drop(&mut self) {
        let _ = unsafe { PowerUnregisterSuspendResumeNotification(self.handle) };
    }
}

unsafe extern "system" fn power_callback(
    context: *const c_void,
    event_type: u32,
    _setting: *const c_void,
) -> u32 {
    if context.is_null() {
        return 0;
    }
    // SAFETY: registration owns this boxed context until after unregistration completes.
    let context = unsafe { &*(context as *const PowerCallbackContext) };
    match event_type {
        PBT_APMSUSPEND => context.emitter.emit(WindowsLifecycleSignal::Suspend),
        PBT_APMRESUMEAUTOMATIC => context.emitter.emit(WindowsLifecycleSignal::Resume),
        _ => {}
    }
    0
}

fn endpoint_matches_source(
    flow: AudioDeviceFlow,
    role: AudioDeviceRole,
    source_kind: SourceKind,
) -> bool {
    matches!(
        (flow, role, source_kind),
        (
            AudioDeviceFlow::Capture,
            AudioDeviceRole::Communications,
            SourceKind::UserMic
        ) | (
            AudioDeviceFlow::Render,
            AudioDeviceRole::Multimedia,
            SourceKind::SystemLoopback | SourceKind::ProcessLoopback
        )
    )
}

fn pcwstr_to_string(value: &PCWSTR) -> String {
    if value.is_null() {
        String::new()
    } else {
        unsafe { value.to_string() }.unwrap_or_default()
    }
}

fn win_error(error: windows::core::Error) -> String {
    error.to_string()
}

struct ComApartment;

impl ComApartment {
    fn initialize() -> Result<Self, String> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(win_error)?;
        Ok(Self)
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signals_are_filtered_by_active_device_and_source_flow() {
        let default_mic = WindowsLifecycleSignal::DefaultDeviceChanged {
            flow: AudioDeviceFlow::Capture,
            role: AudioDeviceRole::Communications,
            device_id: Some("mic-b".into()),
        };
        assert!(matches!(
            default_mic.to_device_event(SourceKind::UserMic, "mic-a"),
            Some(DeviceLifecycleEvent::DefaultDeviceChanged { .. })
        ));
        assert_eq!(
            default_mic.to_device_event(SourceKind::SystemLoopback, "render-a"),
            None
        );

        let removed = WindowsLifecycleSignal::DeviceRemoved {
            device_id: "mic-a".into(),
        };
        assert!(matches!(
            removed.to_device_event(SourceKind::UserMic, "mic-a"),
            Some(DeviceLifecycleEvent::DeviceUnplugged { .. })
        ));
        assert_eq!(removed.to_device_event(SourceKind::UserMic, "mic-b"), None);
    }
}
