use std::fs;
use std::path::Path;

use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};

fn main() {
    if let Err(error) = run() {
        eprintln!("P4FNV release crypto error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [command, private] if command == "keygen" => keygen(Path::new(private)),
        [command, private] if command == "public" => {
            println!("{}", encode_public(&read_signing_key(Path::new(private))?));
            Ok(())
        }
        [command, private, input, signature] if command == "sign" => {
            sign(Path::new(private), Path::new(input), Path::new(signature))
        }
        [command, public, input, signature] if command == "verify" => {
            verify(public, Path::new(input), Path::new(signature))
        }
        _ => Err(
            "usage: p4fnv-release-crypto keygen <private-file> | public <private-file> | sign <private-file> <input> <signature> | verify <public-base64> <input> <signature>"
                .to_owned(),
        ),
    }
}

fn keygen(private_path: &Path) -> Result<(), String> {
    if private_path.exists() {
        return Err(format!(
            "refusing to overwrite existing private key: {}",
            private_path.display()
        ));
    }
    let parent = private_path
        .parent()
        .filter(|path| path.is_dir())
        .ok_or_else(|| "the private key directory does not exist".to_owned())?;
    let mut seed = [0_u8; 32];
    getrandom::fill(&mut seed).map_err(|error| format!("secure key generation failed: {error}"))?;
    let signing = SigningKey::from_bytes(&seed);
    let encoded = base64::engine::general_purpose::STANDARD.encode(seed);
    write_private_file(private_path, encoded.as_bytes())?;
    if private_path.parent() != Some(parent) {
        return Err("private key path changed during creation".to_owned());
    }
    println!("P4FNV_UPDATE_PUBLIC_KEY={}", encode_public(&signing));
    Ok(())
}

fn write_private_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_HIDDEN;
        let mut options = fs::OpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .attributes(FILE_ATTRIBUTE_HIDDEN);
        use std::io::Write;
        options
            .open(path)
            .and_then(|mut file| file.write_all(contents))
            .map_err(|error| error.to_string())
    }
    #[cfg(not(windows))]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .and_then(|mut file| file.write_all(contents))
            .map_err(|error| error.to_string())
    }
}

fn read_signing_key(path: &Path) -> Result<SigningKey, String> {
    let encoded = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let seed: [u8; 32] = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|_| "private key is not valid base64".to_owned())?
        .try_into()
        .map_err(|_| "private key must contain exactly 32 bytes".to_owned())?;
    Ok(SigningKey::from_bytes(&seed))
}

fn encode_public(signing: &SigningKey) -> String {
    base64::engine::general_purpose::STANDARD.encode(signing.verifying_key().to_bytes())
}

fn sign(private_path: &Path, input_path: &Path, signature_path: &Path) -> Result<(), String> {
    let signing = read_signing_key(private_path)?;
    let input = fs::read(input_path).map_err(|error| error.to_string())?;
    let signature =
        base64::engine::general_purpose::STANDARD.encode(signing.sign(&input).to_bytes());
    fs::write(signature_path, format!("{signature}\n")).map_err(|error| error.to_string())
}

fn verify(public: &str, input_path: &Path, signature_path: &Path) -> Result<(), String> {
    let public: [u8; 32] = base64::engine::general_purpose::STANDARD
        .decode(public.trim())
        .map_err(|_| "public key is not valid base64".to_owned())?
        .try_into()
        .map_err(|_| "public key must contain exactly 32 bytes".to_owned())?;
    let verifying = VerifyingKey::from_bytes(&public).map_err(|error| error.to_string())?;
    let signature_text = fs::read_to_string(signature_path).map_err(|error| error.to_string())?;
    let signature_bytes = base64::engine::general_purpose::STANDARD
        .decode(signature_text.trim())
        .map_err(|_| "signature is not valid base64".to_owned())?;
    let signature = Signature::from_slice(&signature_bytes).map_err(|error| error.to_string())?;
    let input = fs::read(input_path).map_err(|error| error.to_string())?;
    verifying
        .verify_strict(&input, &signature)
        .map_err(|_| "signature verification failed".to_owned())
}
