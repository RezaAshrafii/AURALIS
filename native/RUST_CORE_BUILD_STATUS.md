# Rust production core status

The production architecture still targets Rust stable + windows-rs. This execution environment does not contain cargo/rustc, so no Rust production binary is claimed.

The bundled Windows validation probe is cross-built from audited Go source to make real WASAPI capture, format decoding, VAD segmentation and ASR integration testable now. The current validation path includes the WAVEFORMATEXTENSIBLE decoding fix used by this build.
