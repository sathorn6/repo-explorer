use std::env;
use std::fs;

mod git;

fn main() {
    let args: Vec<String> = env::args().collect();
    let file = &args[1];
    println!("Opening {}", file);

    let buf = fs::read(file).unwrap();

    git::parse_pack(&buf[8..]);
}
