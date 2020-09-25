use wasm_bindgen::prelude::*;

// mod git;

#[wasm_bindgen]
pub fn hi() -> Result<i32, JsValue> {
    // git::parse_pack(&vec![0, 1, 2, 3]);

    Ok(1)
}