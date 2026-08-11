# Rust production core status — v0.10.5 validation build

The production architecture still targets Rust stable + windows-rs. This execution environment does not contain cargo/rustc, so no Rust production binary is claimed.

The bundled Windows validation probe is cross-built from audited Go source to make real WASAPI capture, format decoding, VAD segmentation and ASR integration testable now. v0.10.5 fixes the Windows WAVEFORMATEXTENSIBLE alignment failure discovered in real user testing.
