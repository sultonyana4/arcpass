import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { join, resolve, dirname, relative } from 'path'

const DOCS_ROOT = resolve(process.cwd(), 'docs')

const EXPECTED_SECTIONS = [
  'getting-started',
  'architecture',
  'backend',
  'frontend',
  'contracts',
  'infrastructure',
  'api',
  'security',
  'operations',
  'roadmap',
  'contributing',
]

const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*\.md$/

const PLACEHOLDER_PATTERNS = [
  /\bTODO\b/i,
  /lorem ipsum/i,
  /\[placeholder\]/i,
  /\[insert .+? here\]/i,
  /FIXME/i,
]

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns null if no valid frontmatter block is found.
 */
function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null

  const yaml = match[1]
  const fields: Record<string, string> = {}

  for (const line of yaml.split('\n')) {
    const kvMatch = line.match(/^(\w+):\s*"?(.+?)"?\s*$/)
    if (kvMatch) {
      fields[kvMatch[1]] = kvMatch[2]
    }
  }

  return fields
}

/**
 * Collect all .md files recursively under a directory.
 */
function collectMarkdownFiles(dir: string): string[] {
  const files: string[] = []
  if (!existsSync(dir)) return files

  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath)
    }
  }
  return files
}

/**
 * Extract relative markdown links from content.
 * Matches [text](./path.md) or [text](../path.md) style links.
 * Excludes external URLs and anchor-only links.
 */
function extractRelativeLinks(content: string): string[] {
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g
  const links: string[] = []
  let match: RegExpExecArray | null

  while ((match = linkRegex.exec(content)) !== null) {
    const href = match[2]
    // Skip external URLs, anchors, and mailto links
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#') || href.startsWith('mailto:')) {
      continue
    }
    // Only include relative paths (starting with ./ or ../ or a filename)
    links.push(href)
  }

  return links
}

describe('Documentation Structure Validation', () => {
  describe('Section directories', () => {
    it('all 11 section directories exist under /docs', () => {
      for (const section of EXPECTED_SECTIONS) {
        const sectionPath = join(DOCS_ROOT, section)
        expect(existsSync(sectionPath), `Missing section directory: docs/${section}`).toBe(true)
        expect(statSync(sectionPath).isDirectory(), `docs/${section} is not a directory`).toBe(true)
      }
    })

    it('each section contains at least one .md file with lowercase kebab-case naming', () => {
      for (const section of EXPECTED_SECTIONS) {
        const sectionPath = join(DOCS_ROOT, section)
        const entries = readdirSync(sectionPath)
        const mdFiles = entries.filter((f) => f.endsWith('.md'))

        expect(mdFiles.length, `Section docs/${section} has no .md files`).toBeGreaterThan(0)

        for (const file of mdFiles) {
          expect(file, `File docs/${section}/${file} does not match kebab-case naming`).toMatch(KEBAB_CASE_REGEX)
        }
      }
    })
  })

  describe('Frontmatter validation', () => {
    it('all .md files have valid YAML frontmatter with title (≤60 chars) and description (≤160 chars)', () => {
      const allMdFiles = collectMarkdownFiles(DOCS_ROOT)
      expect(allMdFiles.length).toBeGreaterThan(0)

      for (const filePath of allMdFiles) {
        const content = readFileSync(filePath, 'utf-8')
        const relativePath = relative(DOCS_ROOT, filePath)
        const frontmatter = parseFrontmatter(content)

        expect(frontmatter, `docs/${relativePath} is missing YAML frontmatter`).not.toBeNull()

        expect(
          frontmatter!.title,
          `docs/${relativePath} is missing 'title' in frontmatter`
        ).toBeDefined()

        expect(
          frontmatter!.title.length,
          `docs/${relativePath} title exceeds 60 chars (${frontmatter!.title.length} chars): "${frontmatter!.title}"`
        ).toBeLessThanOrEqual(60)

        expect(
          frontmatter!.description,
          `docs/${relativePath} is missing 'description' in frontmatter`
        ).toBeDefined()

        expect(
          frontmatter!.description.length,
          `docs/${relativePath} description exceeds 160 chars (${frontmatter!.description.length} chars)`
        ).toBeLessThanOrEqual(160)
      }
    })
  })

  describe('Index page', () => {
    it('docs/index.md exists', () => {
      const indexPath = join(DOCS_ROOT, 'index.md')
      expect(existsSync(indexPath), 'docs/index.md does not exist').toBe(true)
    })

    it('docs/index.md contains links to all sections', () => {
      const indexPath = join(DOCS_ROOT, 'index.md')
      const content = readFileSync(indexPath, 'utf-8')

      for (const section of EXPECTED_SECTIONS) {
        expect(
          content.includes(`./${section}/`) || content.includes(`${section}/`),
          `docs/index.md is missing a link to the '${section}' section`
        ).toBe(true)
      }
    })
  })

  describe('No placeholder content', () => {
    it('no files contain TODO, lorem ipsum, or placeholder markers', () => {
      const allMdFiles = collectMarkdownFiles(DOCS_ROOT)

      for (const filePath of allMdFiles) {
        const content = readFileSync(filePath, 'utf-8')
        const relativePath = relative(DOCS_ROOT, filePath)

        for (const pattern of PLACEHOLDER_PATTERNS) {
          expect(
            pattern.test(content),
            `docs/${relativePath} contains placeholder content matching: ${pattern}`
          ).toBe(false)
        }
      }
    })
  })

  describe('Cross-link validation', () => {
    it('all relative cross-links resolve to existing files', () => {
      const allMdFiles = collectMarkdownFiles(DOCS_ROOT)
      const brokenLinks: string[] = []

      for (const filePath of allMdFiles) {
        const content = readFileSync(filePath, 'utf-8')
        const relativePath = relative(DOCS_ROOT, filePath)
        const links = extractRelativeLinks(content)
        const fileDir = dirname(filePath)

        for (const link of links) {
          // Strip anchor fragments from the link
          const linkPath = link.split('#')[0]
          if (!linkPath) continue // anchor-only after stripping

          const resolvedPath = resolve(fileDir, linkPath)

          if (!existsSync(resolvedPath)) {
            brokenLinks.push(`docs/${relativePath} → ${link}`)
          }
        }
      }

      expect(
        brokenLinks,
        `Found broken internal links:\n${brokenLinks.join('\n')}`
      ).toHaveLength(0)
    })
  })
})
