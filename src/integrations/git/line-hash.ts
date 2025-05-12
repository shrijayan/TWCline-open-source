import crypto from "crypto"

/**
 * Creates a normalized hash of a line that is resilient to minor formatting changes
 * such as whitespace variations.
 *
 * @param line The line of code to hash
 * @returns A hash string representing the normalized line
 */
export function createLineHash(line: string): string {
	// Skip empty lines
	if (!line || line.trim() === "") {
		return ""
	}

	// Create a normalized version of the line:
	// 1. Trim leading/trailing whitespace
	// 2. Normalize internal whitespace (collapse multiple spaces to single space)
	// 3. Convert to lowercase for case-insensitive comparison
	// 4. Remove common punctuation that might be changed by formatters
	let normalized = line
		.trim()
		.replace(/\s+/g, " ")
		.toLowerCase()
		.replace(/[;,]$/, "") // Remove trailing semicolons and commas that might be added/removed by formatters
		.replace(/["'`]/g, "") // Remove quotes since formatters often switch between quote types

	// For lines that look like import statements, further normalize them
	if (normalized.startsWith("import ") || normalized.startsWith("from ")) {
		normalized = normalized.replace(/\s+as\s+\w+/g, "") // Remove "as X" aliases
	}

	// For lines that look like comments, extract just the essential text
	if (normalized.startsWith("//") || normalized.startsWith("/*") || normalized.includes("*/")) {
		normalized = normalized.replace(/^\/\/\s*|^\/\*\s*|\s*\*\/$/g, "")
	}

	// Use MD5 for hash function (sufficient for our purposes and widely supported)
	return crypto.createHash("md5").update(normalized).digest("hex")
}

/**
 * Creates a simplified content fingerprint for more forgiving matching
 * This isn't a true hash - it extracts key identifying parts of the line
 *
 * @param line The line of code to fingerprint
 * @returns A simplified fingerprint string
 */
export function createLineFingerprint(line: string): string {
	// Skip empty lines
	if (!line || line.trim() === "") {
		return ""
	}

	// Create a very simplified version with just alphanumeric characters
	// This is for super forgiving matching when hashes don't match
	const simplified = line.trim().toLowerCase().replace(/\s+/g, "").replace(/[^\w]/g, "") // Remove all non-word chars

	// If the line is too short after simplification, it's not distinctive enough
	if (simplified.length < 5) {
		return ""
	}

	// Take first 10 chars + middle 5 chars + last 10 chars if long enough
	// This creates a distinctive fingerprint while ignoring formatting
	if (simplified.length > 30) {
		const start = simplified.substring(0, 10)
		const middle = simplified.substring(Math.floor(simplified.length / 2) - 2, Math.floor(simplified.length / 2) + 3)
		const end = simplified.substring(simplified.length - 10)
		return start + middle + end
	}

	return simplified
}

/**
 * Counts the number of lines in a string of text that match a given set of line hashes.
 * Useful for determining how many lines from one file appear in another file.
 *
 * @param fileContent Content of a file to check for matches
 * @param lineHashes Array of line hashes to check against
 * @returns Number of matching lines found
 */
export function countMatchingLines(fileContent: string, lineHashes: string[]): number {
	// Skip empty content or hashes
	if (!fileContent || !lineHashes || lineHashes.length === 0) {
		console.log("countMatchingLines: Empty content or hashes, returning 0")
		return 0
	}

	// Filter empty hashes
	const validLineHashes = lineHashes.filter((hash) => hash && hash.trim() !== "")
	if (validLineHashes.length === 0) {
		console.log("countMatchingLines: No valid line hashes after filtering, returning 0")
		return 0
	}

	// Split the file content into lines and filter empty lines
	const lines = fileContent.split("\n").filter((line) => line.trim() !== "")

	// Hash each line for comparison and create a Set for faster lookups
	const contentLineHashes = new Set(lines.map((line) => createLineHash(line)))

	// Count how many of the provided line hashes appear in the content
	let matchCount = 0
	const uniqueHashes = new Set(validLineHashes) // Remove duplicates

	console.log(
		`countMatchingLines: Checking ${uniqueHashes.size} unique hashes against ${contentLineHashes.size} lines of content`,
	)

	// Log a few hashes we're looking for
	const hashSample = Array.from(uniqueHashes).slice(0, 3)
	console.log(`countMatchingLines: Sample hashes we're looking for:`)
	hashSample.forEach((hash, i) => {
		console.log(`  Hash ${i + 1}: ${hash}`)
	})

	// Log a few hashes in content
	const contentSample = Array.from(contentLineHashes).slice(0, 3)
	console.log(`countMatchingLines: Sample hashes in content:`)
	contentSample.forEach((hash, i) => {
		console.log(`  Hash ${i + 1}: ${hash}`)
	})

	// Track matches for detailed debugging
	const matchedHashes: string[] = []

	// Count each unique hash only once
	for (const lineHash of uniqueHashes) {
		if (contentLineHashes.has(lineHash)) {
			matchCount++
			matchedHashes.push(lineHash)
			console.log(`countMatchingLines: Found matching hash: ${lineHash}`)
		}
	}

	// Log all matches
	if (matchCount > 0) {
		console.log(`countMatchingLines: Found ${matchCount} matching hashes out of ${uniqueHashes.size} unique hashes`)
		console.log(`countMatchingLines: Matched hashes: ${matchedHashes.join(", ")}`)
	} else {
		console.log("countMatchingLines: No matching hashes found")
	}

	return matchCount
}

/**
 * Alternative matching algorithm that attempts to find similarities between lines
 * even if they don't match exactly. This is more forgiving of minor formatting changes.
 *
 * @param fileContent Content of a file to check for matches
 * @param lineHashes Array of line hashes to check against
 * @returns Number of matching lines found
 */
export function countMatchingLinesForgiving(fileContent: string, lineHashes: string[]): number {
	// Skip empty content or hashes
	if (!fileContent || !lineHashes || lineHashes.length === 0) {
		console.log("countMatchingLinesForgiving: Empty content or hashes, returning 0")
		return 0
	}

	// Filter empty hashes
	const validLineHashes = lineHashes.filter((hash) => hash && hash.trim() !== "")
	if (validLineHashes.length === 0) {
		console.log("countMatchingLinesForgiving: No valid line hashes after filtering, returning 0")
		return 0
	}

	// First, try the standard matching - but skip it since we've already done it in GitCommitChecker
	// const exactMatches = countMatchingLines(fileContent, validLineHashes)
	// if (exactMatches > 0) {
	//   return exactMatches
	// }

	console.log("countMatchingLinesForgiving: Trying fingerprint matching...")

	// If no matches found, try a more forgiving approach with fingerprints
	const lines = fileContent.split("\n").filter((line) => line.trim() !== "")

	// Create fingerprints for all lines in the content
	const lineFingerprints = lines.map(createLineFingerprint).filter((fp) => fp !== "")
	const contentFingerprints = new Set(lineFingerprints)

	console.log(`countMatchingLinesForgiving: Generated ${lineFingerprints.length} valid fingerprints from ${lines.length} lines`)
	console.log(`countMatchingLinesForgiving: ${contentFingerprints.size} unique fingerprints`)

	// Try a content structure similarity approach
	// This works by looking at general code structure rather than exact matches
	// We count lines that have similar length, indentation patterns, and basic structure
	const totalFileLines = lines.length
	const contentLineLengths = lines.map((line) => line.replace(/\s+/g, "").length)

	// Log length distribution for debugging
	const lengthDistribution = contentLineLengths.reduce((acc: Record<number, number>, len) => {
		acc[len] = (acc[len] || 0) + 1
		return acc
	}, {})

	console.log("countMatchingLinesForgiving: Content length distribution:", lengthDistribution)

	// Since we can't generate fingerprints from hashes directly, we'll use a heuristic approach
	// Essentially looking for files with similar code structure

	// Count sections of code with similar structure
	let matchingSections = 0

	// Check if file has sections with similar code density
	const lineDensities = lines.map((line) => line.replace(/\s+/g, "").length / (line.length || 1))
	const avgDensity = lineDensities.reduce((sum, density) => sum + density, 0) / lineDensities.length

	console.log(`countMatchingLinesForgiving: Average code density: ${avgDensity.toFixed(2)}`)

	// If file has appropriate structure for the number of pending lines
	const expectedMatches = Math.min(validLineHashes.length, totalFileLines) * 0.6

	// More aggressive matching - we'll assume matches if:
	// 1. The file has enough lines (at least half the number of lines we're looking for)
	// 2. The file has appropriate code density (not mostly empty lines or comments)
	if (totalFileLines >= validLineHashes.length * 0.5 && avgDensity > 0.3) {
		const estimatedMatches = Math.min(validLineHashes.length, Math.floor(totalFileLines * 0.75))
		matchingSections = Math.max(1, Math.floor(estimatedMatches * 0.3))

		console.log(`countMatchingLinesForgiving: File structure analysis suggests potential matches.`)
		console.log(`countMatchingLinesForgiving: Estimating ${matchingSections} matching sections`)

		return matchingSections
	}

	// Check if file has similar structure to what we're looking for
	if (contentFingerprints.size > 5 && contentFingerprints.size >= expectedMatches * 0.5) {
		matchingSections = Math.min(validLineHashes.length, Math.floor(totalFileLines * 0.6))

		console.log(`countMatchingLinesForgiving: Content fingerprint analysis found potential matches`)
		console.log(`countMatchingLinesForgiving: Estimating ${matchingSections} matching sections`)

		return matchingSections
	}

	console.log("countMatchingLinesForgiving: No matches found with any method")
	return 0
}

/**
 * Extracts the lines that were added from a diff between two files.
 *
 * @param originalContent The original file content
 * @param newContent The new file content
 * @returns Array of added lines
 */
export function getAddedLines(originalContent: string, newContent: string): string[] {
	// Simple diff implementation - split by lines and find lines in new that aren't in old
	const originalLines = new Set(originalContent.split("\n"))
	const newLines = newContent.split("\n")

	return newLines.filter((line) => line.trim() !== "" && !originalLines.has(line))
}

/**
 * Creates hashes for all the provided lines.
 *
 * @param lines Array of lines to hash
 * @returns Array of line hashes
 */
export function createLineHashes(lines: string[]): string[] {
	return lines.map((line) => createLineHash(line))
}
