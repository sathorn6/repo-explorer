use compress::zlib;
use crypto::digest::Digest;
use crypto::sha1::Sha1;
use std::collections::HashMap;
use std::collections::HashSet;
use std::convert::TryInto;
use std::io::Read;
use std::str;

pub type GitTree = Vec<GitTreeEntry>;

const SHA_SIZE: usize = 20;

pub fn parse_tree(data: &[u8]) -> GitTree {
    let mut entries = Vec::<GitTreeEntry>::new();

    /*
     * Tree format:
     * 100644 git.ts\0<sha1>100644 nextfile.ts\0<sha1>...
     */
    let mut entry_start_pos: usize = 0;
    let mut seek_pos: usize = 0;
    while seek_pos < data.len() {
        // Search for the next null byte, which will be in the middle of the next entry
        if data[seek_pos] == 0 {
            entries.push(parse_entry(
                &data[entry_start_pos..seek_pos],
                &data[(seek_pos + 1)..=(seek_pos + SHA_SIZE)],
            ));
            entry_start_pos = seek_pos + SHA_SIZE + 1;
            seek_pos = entry_start_pos;
            continue;
        }
        seek_pos += 1;
    }

    entries
}

pub struct GitTreeEntry {
    is_dir: bool,
    pub name: String,
    sha: Vec<u8>,
}

fn parse_entry(data: &[u8], sha: &[u8]) -> GitTreeEntry {
    let entry_str = str::from_utf8(data).unwrap();
    let mut parts = entry_str.split_whitespace();
    let mode = parts.next().unwrap();
    let name = parts.next().unwrap();

    GitTreeEntry {
        is_dir: mode.as_bytes()[0] != b'1', // If mode starts with 1 it's a blob, so we believe it to be a tree otherwise
        name: name.to_owned(),
        sha: sha.to_vec()
    }
}

pub struct GitCommit {
    tree_sha: Vec<u8>,
    parents: Vec<Vec<u8>>,
}

pub fn parse_commit(data: &[u8]) -> GitCommit {
    /*
     * Commit format:
     * tree <sha>\n
     * then 0 or more times:
     * parent <sha>\n
     * ...some more lines we don't care about
     * \n\n
     * commit message
     */

    let content = str::from_utf8(&data).unwrap();
    let header = content.split("\n\n").nth(0).unwrap();

    let mut tree: Option<Vec<u8>> = None;
    let mut parents = Vec::<Vec<u8>>::new();

    for line in header.split("\n") {
        let mut parts = line.splitn(2, ' ');
        let name = parts.next().unwrap();
        let value = parts.next().unwrap();
        match name {
            "tree" => tree = Some(hex::decode(value).unwrap()),
            "parent" => parents.push(hex::decode(value).unwrap()),
            _ => {}
        }
    }

    GitCommit {
        tree_sha: tree.unwrap(), // We believe every commit to have a tree
        parents,
    }
}

/**
 * A wrapper for a Read that counts how many bytes have been read.
 */
struct ReadCounter<T> {
    inner: T,
    read: usize,
}

impl<T: Read> Read for &mut ReadCounter<T> {
    fn read(&mut self, mut buf: &mut [u8]) -> Result<usize, std::io::Error> {
        let res = self.inner.read(&mut buf);
        match res {
            Ok(s) => self.read += s,
            _ => {}
        }
        return res;
    }
}

fn ashex(data: &[u8]) -> String {
    let mut res = String::with_capacity(data.len() * 2);
    for byte in data {
        res.push_str(format!("{:02x}", byte).as_str());
    }
    res
}

#[derive(PartialEq, Clone)]
enum PackObjectType {
    ObjCommit = 1,
    ObjTree = 2,
    ObjBlob = 3,
    ObjTag = 4,
    ObjOfsDelta = 6,
    ObjRefDelta = 7,
}

impl PackObjectType {
    pub fn new(v: u8) -> PackObjectType {
        match v {
            1 => PackObjectType::ObjCommit,
            2 => PackObjectType::ObjTree,
            3 => PackObjectType::ObjBlob,
            4 => PackObjectType::ObjTag,
            6 => PackObjectType::ObjOfsDelta,
            7 => PackObjectType::ObjRefDelta,
            _ => panic!("Unknown pack object type {}", v),
        }
    }

    pub fn git_name(self: &Self) -> Option<&'static str> {
        match self {
            PackObjectType::ObjCommit => Some("commit"),
            PackObjectType::ObjTree => Some("tree"),
            PackObjectType::ObjBlob => Some("blob"),
            PackObjectType::ObjTag => Some("tag"),
            _ => None,
        }
    }
}

struct PackObject {
    obj_type: PackObjectType,
    data: Vec<u8>,
}

pub struct ParsePackResult {
    commits: HashMap<Vec<u8>, GitCommit>,
    trees: HashMap<Vec<u8>, GitTree>
}

pub fn parse_pack(data: &[u8]) -> ParsePackResult {
    // Read header
    let magic = str::from_utf8(&data[0..4]).unwrap();
    assert_eq!(magic, "PACK");
    let _version = u32::from_be_bytes(data[4..8].try_into().unwrap());
    let num_objects = u32::from_be_bytes(data[8..12].try_into().unwrap());

    let mut count: u32 = 0;
    let mut objects = HashMap::<Vec<u8>, PackObject>::new();

    let mut p: usize = 12;

    // Read all packed entries
    while p < data.len() - SHA_SIZE {
        count += 1;

        // First read the n-byte type and len (unpacked) of the obj
        let first_byte = data[p];

        let mut obj_type = PackObjectType::new((first_byte << 1 >> 5) as u8);
        let mut len = (first_byte << 4 >> 4) as u64;

        let msb = 1 << 7;
        let mut n = 0;
        while data[p + n] & msb != 0 {
            // While MSB for the current byte not set
            n += 1;
            let byte = (data[p + n] & !msb) as u64; // Without msb
            len += byte << (4 + 7 * (n - 1)); // Shift bits into place
        }
        p += n + 1;

        if obj_type == PackObjectType::ObjOfsDelta {
            panic!("Unsupported.");
        }

        let mut delta_ref: Option<&[u8]> = None;
        if obj_type == PackObjectType::ObjRefDelta {
            /*
                20-byte base object name if OBJ_REF_DELTA or a negative relative
                offset from the delta object's position in the pack if this
                is an OBJ_OFS_DELTA object
            */
            delta_ref = Some(&data[p..p + 20]);
            println!("its a delta {}", ashex(delta_ref.unwrap()));
            p += 20;
        }

        let mut decompressed = Vec::new();
        if len > 0 {
            /*
            * We actually don't know how long the zlib-compressed object is.
            * So we just uncompress it and count how many bytes zlib is reading.
            */
            let mut counter = ReadCounter::<&[u8]> {
                inner: &data[p..],
                read: 0,
            };

            zlib::Decoder::new(&mut counter)
                .read_to_end(&mut decompressed)
                .unwrap();

            // Our zlib implementation doesn't read the checksum at the end so we need to add 4 bytes
            p += counter.read + 4;
        } else {
            // Empty object has this size
            p += 8;
        }

        assert_eq!(len as usize, decompressed.len());

        if let Some(delta_ref) = delta_ref {
            if let Some(base_obj) = objects.get(delta_ref) {
                let undeltified = apply_delta(&base_obj.data, &decompressed);
                obj_type = base_obj.obj_type.clone(); // We take the type of the base obj
                decompressed = undeltified; // And use the undeltified data
            } else {
                // The refed object comes later, we can't handle this yet
                println!("refed object not found")
            }
        }

        if let Some(name) = obj_type.git_name() {
            // It's a non-deltified object
            let mut buf = Vec::new();
            buf.extend(
                format!("{} {}\0", name, decompressed.len())
                    .as_bytes()
                    .iter()
                    .cloned(),
            );
            buf.extend(decompressed.iter().cloned());

            let mut hasher = Sha1::new();
            hasher.input(&buf);

            let mut sha = vec![0; SHA_SIZE];
            hasher.result(&mut sha);
            println!("inserting {} {}", name, ashex(&sha));
            objects.insert(sha, PackObject {
                obj_type,
                data: decompressed
            });
        }
    }

    assert_eq!(count, num_objects);

    let mut commits = HashMap::<Vec<u8>, GitCommit>::new();
    let mut trees = HashMap::<Vec<u8>, GitTree>::new();

    for (sha, object) in &objects {
        if object.obj_type == PackObjectType::ObjCommit {
            let mut buf = Vec::new();
            buf.extend(
                format!("{} {}\0", object.obj_type.git_name().unwrap(), object.data.len())
                    .as_bytes()
                    .iter()
                    .cloned(),
            );
            buf.extend(object.data.iter().cloned());
            commits.insert((&sha).to_vec().clone(), parse_commit(&object.data[..]));
        }
        if object.obj_type == PackObjectType::ObjTree {
            let mut buf = Vec::new();
            buf.extend(
                format!("{} {}\0", object.obj_type.git_name().unwrap(), object.data.len())
                    .as_bytes()
                    .iter()
                    .cloned(),
            );
            buf.extend(object.data.iter().cloned());
            trees.insert((&sha).to_vec().clone(), parse_tree(&object.data[..]));
        }
    }

    ParsePackResult {
        commits: commits,
        trees: trees
    }
}

fn apply_delta(base: &[u8], delta: &[u8]) -> Vec<u8> {
    let mut result = Vec::new();

    let msb = 1 << 7 as u8;

    let mut p = 0;

    // Source length n-byte, that we ignore
    while delta[p] & msb != 0 {
        p += 1;
    }
    p += 1;

    // Target length n-byte, that we ignore
    while delta[p] & msb != 0 {
        p += 1;
    }
    p += 1;

    // The rest of delta is series of instructions
    while p < delta.len() {
        let instr = delta[p];
        p += 1;

        if instr == 0 {
            // Reserved for future use
            panic!("Instruction 0 not implemented");
        } else if instr & msb != 0 {
            // If msb is set, it's a copy from base instruction
            let mut base_offset: u32 = 0;
            let mut copy_size: u32 = 0;

            if instr & 1 << 0 != 0 {
                base_offset += delta[p] as u32;
                p += 1;
            }
            if instr & 1 << 1 != 0 {
                base_offset += (delta[p] as u32) << 8;
                p += 1;
            }
            if instr & 1 << 2 != 0 {
                base_offset += (delta[p] as u32) << 16;
                p += 1;
            }
            if instr & 1 << 3 != 0 {
                base_offset += (delta[p] as u32) << 24;
                p += 1;
            }

            if instr & 1 << 4 != 0 {
                copy_size += delta[p] as u32;
                p += 1;
            }
            if instr & 1 << 5 != 0 {
                copy_size += (delta[p] as u32) << 8;
                p += 1;
            }
            if instr & 1 << 6 != 0 {
                copy_size += (delta[p] as u32) << 16;
                p += 1;
            }

            let offset = base_offset as usize;
            let size = copy_size as usize;

            result.extend(&base[offset..offset + size]);
        } else {
            // Otherwise it's an instruction to add new data
            let data_len = instr as usize;
            result.extend(&delta[p..p + data_len]);
            p += data_len;
        }
    }

    result
}

pub struct ChangeCounter<'a> {
    pack: &'a ParsePackResult,
    processed_commits: HashSet<Vec<u8>>,
    num_changes: HashMap<String, u32>
}

use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize)]
pub struct TreeNode {
	pub name: String,
	pub r#type: String,
	pub numChanges: u32,
	pub numFiles: u32,
	pub children: Vec<Box<TreeNode>>
}

impl ChangeCounter<'_> {
    // Another static method, taking two arguments:
    pub fn process(pack: &ParsePackResult, head_commit: &[u8]) -> TreeNode {
        let mut comp = ChangeCounter {
            pack,
            processed_commits: HashSet::new(),
            num_changes: HashMap::new()
        };
        let head = pack.commits.get(head_commit).unwrap();
        comp.walk_commit(head_commit);
        comp.build_tree_node(String::from("/"), String::from(""), &head.tree_sha)
    }

    fn count_change(&mut self, path: String) {
        let previous = self.num_changes.get(&path).unwrap_or(&0);
        self.num_changes.insert(path, previous + 1);
    }

    fn record_changes(&mut self, from_tree: &[u8], to_tree: &[u8], prefix: Vec<String>) {
        if from_tree == to_tree {
            // Trees are identical
            return
        }

        let a = self.pack.trees.get(from_tree).unwrap();
        let b = self.pack.trees.get(to_tree).unwrap();
    
        for entry in a {
            if entry.is_dir {
                if let Some(in_b) = b.iter().find(|&ent| ent.name == entry.name && ent.is_dir) {
                    if entry.sha != in_b.sha {
                        // There were changes in the dir
                        let mut new_prefix = prefix.clone();
                        new_prefix.push(format!("{}{}/", prefix.last().unwrap(), entry.name));
                        self.record_changes(&entry.sha, &in_b.sha, new_prefix)
                    }
                } // Otherwise the dir was deleted (or moved)
            } else {
                if let Some(in_b) = b.iter().find(|&ent| ent.name == entry.name && !ent.is_dir) {
                    if entry.sha != in_b.sha {
                        for dir in &prefix {
                            self.count_change(dir.to_string());
                        }
                        self.count_change(format!("{}{}", prefix.last().unwrap(), entry.name));
                    }
                } // Otherwise the file was deleted (or moved)
            }
        }
    }
    
    fn walk_commit(&mut self, commit_sha: &[u8]) {
        if self.processed_commits.contains(commit_sha) {
            return
        }
        self.processed_commits.insert(commit_sha.to_vec());
    
        let commit = self.pack.commits.get(commit_sha).unwrap();

        for parent_sha in &commit.parents {
            let parent = self.pack.commits.get(parent_sha).unwrap();
            self.record_changes(&parent.tree_sha, &commit.tree_sha, vec![String::from("/")]);
            self.walk_commit(parent_sha);
        }
    }

    fn build_tree_node(&self, path: String, name: String, tree_sha: &[u8]) -> TreeNode {
        let tree = self.pack.trees.get(tree_sha).unwrap();
        let mut children = Vec::new();

        for entry in tree {
            if entry.is_dir {
                children.push(Box::new(self.build_tree_node(format!("{}{}/", path, entry.name), entry.name.clone(), &entry.sha)));
            } else {
                children.push(Box::new(TreeNode {
                    name: entry.name.clone(),
                    r#type: String::from("file"),
                    numChanges: *self.num_changes.get(&format!("{}{}", path, entry.name)).unwrap_or(&0),
                    numFiles: 666,
                    children: vec![]
                }));
            }
        }

        TreeNode {
            name,
            r#type: String::from("directory"),
            numChanges: *self.num_changes.get(&path).unwrap_or(&0),
            numFiles: 666,
            children
        }
    }
}


