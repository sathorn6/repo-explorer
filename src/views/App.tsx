import React, { useState, useEffect } from "react";
import { analyzeRepo, TreeNode, followPath } from "../git";

export const App = () => {
	const [repo, setRepo] = useState("https://github.com/sathorn6/repo-explorer");
	const [exploring, setExploring] = useState(false);

	if (exploring) {
		return <Explore repo={repo} />;
	}

	return (
		<div>
			<h1>Git Repo Explorer</h1>
			<div>
				<input
					type="text"
					value={repo}
					onChange={e => setRepo(e.target.value)}
				/>
				<button onClick={() => setExploring(true)}>explore</button>
			</div>
		</div>
	);
};

const Explore = ({ repo }: { repo: string }) => {
	const [tree, setTree] = useState();

	useEffect(() => {
		const worker = async () => {
			setTree(await analyzeRepo(repo));
		};

		worker();
	}, [repo]);

	return (
		<div>
			Analyzing {repo}
			{tree && <ResultView root={tree} />}
		</div>
	);
};

const ResultView = ({ root }: { root: TreeNode }) => {
	const [path, setPath] = useState("");
	const dirs = path.split("/");
	dirs.pop();
	const parent = dirs.join("/");

	const node = followPath(root, path);

	return (
		<div>
			<div>
				<input
					type="text"
					value={path}
					onChange={event => setPath(event.target.value)}
				/>
			</div>
			<PathNavigator path={path} setPath={setPath} rootName="root" />
			{node && (
				<TreeView
					tree={node}
					onClick={entry => {
						if (entry.type === "directory") {
							setPath((path ? path + "/" : "") + entry.name);
						}
					}}
					onGoUp={path ? () => setPath(parent) : undefined}
				/>
			)}
		</div>
	);
};

const PathNavigator = ({
	rootName,
	path,
	setPath
}: {
	rootName: string;
	path: string;
	setPath: (path: string) => void;
}) => {
	const dirs = path.split("/");
	if (dirs[0] === "") {
		dirs.shift();
	}

	return (
		<div>
			<button onClick={() => setPath("")}>{rootName}</button>
			{dirs.map((dir, i) => (
				<button key={i} onClick={() => setPath(dirs.slice(0, i + 1).join("/"))}>
					{dir}
				</button>
			))}
		</div>
	);
};

const TreeView = ({
	tree,
	onClick,
	onGoUp
}: {
	tree: TreeNode;
	onClick: (entry: TreeNode) => void;
	onGoUp?: () => void;
}) => {
	const sortedChildren = Array.from(tree.children).sort((a, b) => {
		if (a.type === b.type) {
			return b.numChanges - a.numChanges;
		}

		if (a.type === "directory") {
			return -1;
		} else {
			return 1;
		}
	});

	return (
		<div>
			<h2>{tree.name}</h2>
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th># of changes</th>
						<th># of files</th>
					</tr>
				</thead>
				<tbody>
					{onGoUp && (
						<tr onClick={onGoUp}>
							<td colSpan={2}>
								<button>..</button>
							</td>
						</tr>
					)}
					{sortedChildren.map((entry, index) => (
						<tr key={index}>
							<td>
								<NodeView node={entry} onClick={() => onClick(entry)} />
							</td>
							<td>{entry.numChanges}</td>
							<td>{entry.numFiles}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
};

const NodeView = ({
	node,
	onClick
}: {
	node: TreeNode;
	onClick: () => void;
}) => {
	switch (node.type) {
		case "directory":
			return <button onClick={onClick}>{node.name}</button>;
		case "file":
			return <span>{node.name}</span>;
	}
};
