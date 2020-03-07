import React, { useState, useEffect } from "react";
import { analyzeRepo, TreeNode, followPath } from "../git";
import { extractRepositoryNameFromUrl, buildFileUrl } from "../url";

export const App = () => {
	return (
		<div className="p-12 max-w-screen-md mx-auto">
			<Home />
		</div>
	);
};

export const Home = () => {
	const [repo, setRepo] = useState("https://github.com/sathorn6/repo-explorer");
	const [exploring, setExploring] = useState(false);

	if (exploring) {
		return <Explore repoUrl={repo} />;
	}

	return (
		<div>
			<svg
				className="m-auto fill-current text-indigo-600"
				width="121"
				height="121"
				viewBox="0 0 121 121"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path
					fill-rule="evenodd"
					clip-rule="evenodd"
					d="M2.94932 53C-0.955922 56.9053 -0.955928 63.2369 2.94931 67.1421L53 117.193C56.9053 121.098 63.2369 121.098 67.1422 117.193L117.193 67.1422C121.098 63.2369 121.098 56.9053 117.193 53L67.1422 2.94932C63.2369 -0.955922 56.9053 -0.955928 53 2.94931L41.6117 14.3376L56.5096 29.2356C57.3531 28.9649 58.2524 28.8188 59.1858 28.8188C64.0182 28.8188 67.9356 32.7362 67.9356 37.5686C67.9356 38.502 67.7894 39.4012 67.5188 40.2447L82.8574 55.5833C84.0856 54.9262 85.489 54.5535 86.9793 54.5535C91.8117 54.5535 95.7292 58.471 95.7292 63.3034C95.7292 68.1357 91.8117 72.0532 86.9793 72.0532C82.1469 72.0532 78.2295 68.1357 78.2295 63.3034C78.2295 62.9721 78.2479 62.6451 78.2838 62.3234L63.7005 47.7401V76.3945C66.2385 77.9263 67.9356 80.7105 67.9356 83.8912C67.9356 88.7236 64.0182 92.641 59.1858 92.641C54.3534 92.641 50.436 88.7236 50.436 83.8912C50.436 80.2975 52.6024 77.2099 55.7005 75.863V45.5967C52.6024 44.2499 50.436 41.1622 50.436 37.5686C50.436 36.6352 50.5821 35.7359 50.8528 34.8924L35.9548 19.9945L2.94932 53Z"
				/>
			</svg>
			<h1 className="text-5xl text-center text-gray-900 font-black tracking-tight">
				Git Repo Explorer
			</h1>
			<h2 className="text-lg text-center text-gray-600">
				Get quick insights into any Git repository.
			</h2>
			<div className="flex flex-col mt-16">
				<label className="text-md text-gray-800 font-bold">
					Git Repository URL:
				</label>
				<div className="flex mt-2">
					<input
						className="flex-1 p-4 text-base border text-gray-900"
						type="text"
						value={repo}
						onChange={e => setRepo(e.target.value)}
					/>
					<button
						className="ml-4 text-lg py-4 px-8 bg-indigo-600 text-white"
						onClick={() => setExploring(true)}
					>
						Explore
					</button>
				</div>
			</div>
		</div>
	);
};

const Explore = ({ repoUrl }: { repoUrl: string }) => {
	const [tree, setTree] = useState();

	useEffect(() => {
		const worker = async () => {
			setTree(await analyzeRepo(repoUrl));
		};

		worker();
	}, [repoUrl]);

	if (tree) {
		return <ResultView root={tree} repoUrl={repoUrl} />;
	}

	return <p className="text-center text-gray-500">Analyzing {repoUrl}...</p>;
};

const ResultView = ({ repoUrl, root }: { repoUrl: string; root: TreeNode }) => {
	const [path, setPath] = useState("");
	const dirs = path.split("/");
	dirs.pop();
	const parent = dirs.join("/");

	const node = followPath(root, path);

	return (
		<div>
			<PathNavigator
				path={path}
				setPath={setPath}
				rootName={extractRepositoryNameFromUrl(repoUrl) || "Repository"}
			/>
			{node && (
				<TreeView
					tree={node}
					repoUrl={repoUrl}
					path={path}
					setPath={setPath}
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
		<div className="mb-4">
			<PathDir currentPath={path} path={""} setPath={setPath}>
				{rootName}
			</PathDir>
			{dirs.map((dir, i) => (
				<React.Fragment key={i}>
					<span className="mx-2 text-gray-500">/</span>
					<PathDir
						currentPath={path}
						path={dirs.slice(0, i + 1).join("/")}
						setPath={setPath}
					>
						{dir}
					</PathDir>
				</React.Fragment>
			))}
		</div>
	);
};

const PathDir = ({
	path,
	currentPath,
	setPath,
	children
}: {
	path: string;
	currentPath: string;
	setPath: (path: string) => void;
	children: React.ReactNode;
}) => {
	const isCurrent = path === currentPath;
	const isRoot = path === "";

	let className = "text-lg ";

	className += isCurrent ? "text-gray-900" : "text-indigo-500 hover:underline";
	if (isRoot) {
		className += " font-bold";
	}

	if (isCurrent) {
		return <span className={className}>{children}</span>;
	} else {
		return (
			<button onClick={() => setPath(path)} className={className}>
				{children}
			</button>
		);
	}
};

const TreeView = ({
	tree,
	repoUrl,
	path,
	setPath,
	onGoUp
}: {
	tree: TreeNode;
	repoUrl: string;
	path: string;
	setPath: (path: string) => void;
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
		<table className="w-full bg-white">
			<thead>
				<tr className="border bg-gray-200">
					<th className="w-full px-4 py-2 text-left">Name</th>
					<th className="whitespace-no-wrap px-4 py-2"># of changes</th>
				</tr>
			</thead>
			<tbody>
				{onGoUp && (
					<tr className="border">
						<td colSpan={3} className="px-4 py-2">
							<button
								className="px-1 py-1 -my-1 hover:bg-indigo-200 rounded text-indigo-500 hover:underline"
								onClick={onGoUp}
							>
								..
							</button>
						</td>
					</tr>
				)}
				{sortedChildren.map((entry, index) => (
					<tr key={index} className="border">
						<td className="px-4 py-2">
							<NodeView
								node={entry}
								repoUrl={repoUrl}
								path={path}
								setPath={setPath}
							/>
						</td>
						<td className="px-4 py-2 text-right">{entry.numChanges}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
};

const NodeView = ({
	node,
	repoUrl,
	path,
	setPath
}: {
	node: TreeNode;
	repoUrl: string;
	path: string;
	setPath: (path: string) => void;
}) => {
	const nodePath = (path ? path + "/" : "") + node.name;

	switch (node.type) {
		case "directory":
			return (
				<>
					<DirectoryIcon />
					<button
						className="ml-1 text-indigo-500 hover:underline"
						onClick={() => setPath(nodePath)}
					>
						{node.name}
					</button>
				</>
			);
		case "file":
			return (
				<>
					<FileIcon />
					<a
						className="ml-1 text-indigo-500 hover:underline"
						target="_blank"
						href={buildFileUrl(repoUrl, nodePath)}
					>
						{node.name}
					</a>
				</>
			);
	}
};

const DirectoryIcon = () => (
	<svg
		className="inline"
		width="16"
		height="16"
		viewBox="0 0 16 16"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
	>
		<path d="M1.5 4V2.5H5.5V4" className="stroke-current text-indigo-300" />
		<path d="M15 14H1V4H15V14Z" className="fill-current text-indigo-500" />
	</svg>
);

const FileIcon = () => (
	<svg
		className="inline stroke-current text-gray-600"
		width="16"
		height="16"
		viewBox="0 0 16 16"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
	>
		<path d="M2.5 13.5V0.5H10L13.5 3.5V13.5H2.5Z" />
		<path d="M4 3.5H9" />
		<path d="M4 6.5H12" />
		<path d="M4 8.5H12" />
		<path d="M4 10.5H12" />
	</svg>
);
