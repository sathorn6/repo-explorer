import init, { process_pack } from "./pkg/rsgit";

export interface AnalyzeSuccess {
	success: true;
	headRef: string;
	root: TreeNode;
}

export interface AnalyzeFailure {
	success: false;
	errorMessage: string;
}

export type AnalyzeResult = AnalyzeSuccess | AnalyzeFailure;

export interface TreeNode {
	name: string;
	type: "file" | "directory";
	numChanges: number;
	children: TreeNode[];
}

export const followPath = (tree: TreeNode, path: string): TreeNode | null => {
	if (path === "") {
		return tree;
	}

	const dirs = path.split("/");

	let current: TreeNode | undefined = tree;
	for (const dir of dirs) {
		current = current.children.find(node => node.name === dir);
		if (!current) {
			return null;
		}
	}

	return current;
};

const wasmInit = init("rsgit_bg.wasm");

export const analyzeRepo = async (repoUrl: string): Promise<AnalyzeResult> => {
	try {
		return fastAnalyzeRepo(repoUrl);
	} catch (error) {
		return {
			success: false,
			errorMessage: error.message
		};
	}
};

export const fastAnalyzeRepo = async (
	repoUrl: string
): Promise<AnalyzeResult> => {
	await wasmInit;

	const url = new URL(repoUrl);
	const baseUrl = `https://cors.isomorphic-git.org/${url.host}${url.pathname}`;

	const headRef = await dicoverHeadRef(baseUrl);

	// Now we can download the pack with git-upload-pack
	const res = await fetch(`${baseUrl}.git/git-upload-pack`, {
		method: "POST",
		headers: [
			["Accept", "application/x-git-upload-pack-result"],
			["Content-Type", "application/x-git-upload-pack-request"]
		],
		body: `0057want ${headRef} filter=blob:none agent=repo-explorer\n00000009done\n`
	});

	if (!res.ok) {
		throw new Error("Request failed.");
	}

	const arrayBuffer = await res.arrayBuffer();
	const data = new Uint8Array(arrayBuffer);

	for (const d of parsePktLines(data)) {
		if (d.type === "pack") {
			const headRefBuf = new Uint8Array(
				headRef.match(/[\da-f]{2}/gi)!.map(h => parseInt(h, 16))
			);
			return {
				success: true,
				headRef,
				root: process_pack(d.data, headRefBuf)
			};
		}
	}
	throw new Error("Could not find pack.");
};

const dicoverHeadRef = async (baseUrl: string) => {
	const refUrl = `${baseUrl}.git/info/refs?service=git-upload-pack`;

	const res = await fetch(refUrl);

	// The Content-Type MUST be `application/x-$servicename-advertisement`.
	const type = res.headers.get("Content-Type");
	if (type !== "application/x-git-upload-pack-advertisement") {
		throw new Error("Server is not speaking smart protocol.");
	}

	// Clients MUST validate the status code is either `200 OK` or `304 Not Modified`.
	if (!res.ok) {
		throw new Error("Request failed.");
	}

	const arrayBuffer = await res.arrayBuffer();
	const data = new Uint8Array(arrayBuffer);

	/**
	 * Clients MUST validate the first five bytes of the response entity
	 * matches the regex `^[0-9a-f]{4}#`.  If this test fails, clients
	 * MUST NOT continue.
	 */
	const firstFiveChars = stringFromAsciiBuffer(data, 0, 5);
	if (!/^[0-9a-f]{4}#$/.test(firstFiveChars)) {
		throw new Error("Invalid response.");
	}

	/**
	 * Clients MUST parse the entire response as a sequence of pkt-line
	 * records.
	 */
	const pktLines = parsePktLines(data);
	const getNext = () => {
		const next = pktLines.next();
		if (next.done) {
			throw new Error("Unexpected end.");
		}
		return next.value.data;
	};
	const firstLineStr = stringFromAsciiBuffer(getNext());
	if (firstLineStr !== "# service=git-upload-pack\n") {
		throw new Error("Invalid first line");
	}
	const dataLine = getNext();

	if (
		stringFromAsciiBuffer(dataLine, 0, 40) ===
		"0000000000000000000000000000000000000000"
	) {
		throw new Error("Ref list is empty.");
	}

	/**
	 * The stream SHOULD include the default ref named `HEAD` as the first ref.
	 */
	if (dataLine[40 + 1 + 4] !== 0) {
		throw new Error("First ref not of the expected size.");
	}
	const headRef = stringFromAsciiBuffer(dataLine, 0, 40 + 1 + 4);
	const [ref, name] = headRef.split(" ");
	if (name !== "HEAD") {
		throw new Error("First ref is unexpectedly not HEAD.");
	}

	return ref;
};

const stringFromAsciiBuffer = (
	data: Uint8Array,
	start = 0,
	length = data.length
): string => {
	const charCodes: number[] = [];

	for (let i = start; i < start + length; i++) {
		const value = data[i];
		if (value > 127) {
			throw new Error("Invalid ASCII character.");
		}
		charCodes.push(value);
	}

	return String.fromCodePoint(...charCodes);
};

function* parsePktLines(
	input: Uint8Array
): Generator<{ type: "pkt-line" | "pack"; data: Uint8Array }> {
	let pos = 0;

	while (pos < input.length) {
		const lengthStr = stringFromAsciiBuffer(input, pos, 4);

		if (lengthStr === "0000") {
			/**
			 * A pkt-line with a length field of 0 ("0000"), called a flush-pkt,
			 * is a special case and MUST be handled differently than an empty
			 * pkt-line ("0004").
			 */
			pos += 4;
			continue;
		}

		if (lengthStr === "PACK") {
			yield { type: "pack", data: input.subarray(pos) };
			return;
		}

		const length = parseInt(lengthStr, 16);
		yield { type: "pkt-line", data: input.subarray(pos + 4, pos + length) };
		pos += length;
	}
}
