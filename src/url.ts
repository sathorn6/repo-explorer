/**
 * https://.../.../dotfiles.git -> dotfiles
 */
export const extractRepositoryNameFromUrl = (url: string): string | null => {
	let baseName = url.split("/").pop()!;

	// Strip .git from the end
	if (baseName.endsWith(".git")) {
		baseName = baseName.substring(0, -4);
	}

	return baseName || null;
};

/**
 * The URL to link to a file directly differ between platforms:
 * Github / Gitlab -> {repo}/blob/{commit}/...path
 * Bitbucket / Gitea -> {repo}/src/{commit}/...path
 *
 * For now we just do the first one.
 */
export const buildFileUrl = (
	repoUrl: string,
	filePath: string,
	commit = "master"
): string => {
	let url = repoUrl;

	// Strip .git from the end
	if (url.endsWith(".git")) {
		url = url.substring(0, -4);
	}

	return `${url}/blob/${commit}/${filePath}`;
};
