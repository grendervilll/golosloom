// Tauri-приложение Golosloom: системная Keychain для ключей шифрования.
// Веб-интерфейс — общий Vue-клиент (frontendDist указывает на web/dist),
// поэтому приложение полностью повторяет веб-версию по виду и функционалу.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use keyring::Entry;

const SERVICE: &str = "com.golosloom.app";

#[tauri::command]
fn secure_set(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secure_get(key: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secure_delete(key: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![secure_set, secure_get, secure_delete])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
