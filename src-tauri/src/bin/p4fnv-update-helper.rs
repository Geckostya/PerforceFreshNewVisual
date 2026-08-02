#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(error) = p4fnv_lib::updates::helper_main() {
        eprintln!("P4FNV update failed: {error}");
        std::process::exit(1);
    }
}
