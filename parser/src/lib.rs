extern crate console_error_panic_hook;
use wasm_bindgen::prelude::*;

mod git;

#[wasm_bindgen]
pub fn process_pack(data: &[u8], head_ref: &[u8]) -> JsValue {
    console_error_panic_hook::set_once();
    let result = git::parse_pack(data);
    let root = git::ChangeCounter::process(&result, head_ref);
    JsValue::from_serde(&root).unwrap()
}