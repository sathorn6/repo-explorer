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
