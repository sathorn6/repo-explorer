import * as git from "isomorphic-git";
import LightningFS from "@isomorphic-git/lightning-fs";

const fs = new LightningFS("fs", { wipe: true });
git.plugins.set("fs", fs);
const pfs = fs.promises;

export interface AnalyzeResult {
	headRef: string;
	root: TreeNode;
}

export interface TreeNode {
	parent?: TreeNode;
	name: string;
	type: "file" | "directory";
	numChanges: number;
	numFiles: number;
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

const incrementNumFiles = (node: TreeNode | undefined) => {
	for (let current = node; current; current = current.parent) {
		current.numFiles++;
	}
};

export const analyzeRepo = async (repoUrl: string): Promise<AnalyzeResult> => {
	const dir = `/${Math.random()}`;

	await pfs.mkdir(dir);

	console.time("clone");
	await git.clone({
		dir,
		corsProxy: "https://cors.isomorphic-git.org",
		url: repoUrl,
		singleBranch: true
	});
	console.timeEnd("clone");

	const changes = new Map<string, number>();
	const countChange = (path: string) => {
		changes.set(path, (changes.get(path) || 0) + 1);
	};

	const compareTrees = async (aId: string, bId: string, prefix = ["/"]) => {
		if (aId === bId) {
			// Trees are identical
			return 0;
		}

		const aTree = await git.readTree({ dir, oid: aId });
		const bTree = await git.readTree({ dir, oid: bId });

		// FIXME: Git submodules show up as type commit
		if (aTree.tree.some(({ type }) => type !== "tree" && type !== "blob")) {
			throw new Error("unknown type");
		}
		if (bTree.tree.some(({ type }) => type !== "tree" && type !== "blob")) {
			throw new Error("unknown type");
		}

		const aTrees = aTree.tree.filter(({ type }) => type === "tree");
		const bTrees = bTree.tree.filter(({ type }) => type === "tree");
		const aBlobs = aTree.tree.filter(({ type }) => type === "blob");
		const bBlobs = bTree.tree.filter(({ type }) => type === "blob");

		// FIXME: We don't treat the creation or deletion of a file as a change

		for (const blob of aBlobs) {
			const inB = bBlobs.find(({ path }) => path === blob.path);

			if (!inB) {
				// File was created, we don't count it
				continue;
			}

			if (blob.oid !== inB.oid) {
				for (const dir of prefix) {
					countChange(dir);
				}
				countChange(`${prefix[prefix.length - 1]}${blob.path}`);
			}
		}

		for (const tree of aTrees) {
			const inB = bTrees.find(({ path }) => path === tree.path);

			if (!inB) {
				// Dir was created, we don't count it
				continue;
			}

			if (tree.oid !== inB.oid) {
				await compareTrees(tree.oid, inB.oid, [
					...prefix,
					prefix[prefix.length - 1] + tree.path + "/"
				]);
			}
		}
	};

	const visitedCommits = new Set();

	const walkCommit = async (commit: git.ReadCommitResult) => {
		if (visitedCommits.has(commit.oid)) {
			return;
		}
		visitedCommits.add(commit.oid);

		const parents = await Promise.all(
			commit.commit.parent.map(oid => git.readCommit({ dir, oid }))
		);

		await Promise.all(
			parents.map(parent =>
				compareTrees(commit.commit.tree, parent.commit.tree)
			)
		);

		await Promise.all(parents.map(walkCommit));
	};

	const headId = (await git.log({ dir, depth: 1 }))[0].oid;
	const head = await git.readCommit({ dir, oid: headId });
	await walkCommit(head);

	const makeTreeNode = async (
		path: string,
		name: string,
		oid: string,
		parent?: TreeNode
	): Promise<TreeNode> => {
		const node: TreeNode = {
			parent,
			name,
			type: "directory",
			numChanges: changes.get(path) || 0,
			numFiles: 0,
			children: []
		};

		const tree = await git.readTree({ dir, oid });

		for (const entry of tree.tree) {
			if (entry.type === "blob") {
				node.children.push({
					parent: node,
					name: entry.path,
					type: "file",
					numChanges: changes.get(path + entry.path) || 0,
					numFiles: 1,
					children: []
				});
				incrementNumFiles(node);
				continue;
			}

			if (entry.type === "tree") {
				node.children.push(
					await makeTreeNode(
						path + entry.path + "/",
						entry.path,
						entry.oid,
						node
					)
				);
				continue;
			}
		}

		return node;
	};

	return {
		headRef: headId,
		root: await makeTreeNode("/", "", headId)
	};
};
