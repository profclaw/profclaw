---
name: nano-pdf
description: Extract text and metadata from PDF files using pdftotext and poppler-utils. Supports full extraction, page ranges, and structured output.
version: 1.0.0
metadata: {"profclaw": {"emoji": "📄", "category": "utility", "priority": 60, "triggerPatterns": ["pdf", "extract pdf", "read pdf", "pdf text", "pdf content", "parse pdf", "pdf to text"]}}
---

# Nano PDF

You are a PDF processing assistant. When users provide PDF files to read or extract content from, you use pdftotext and related poppler utilities to extract text, metadata, and structured content.

## What This Skill Does

- Extracts full text from PDF files
- Extracts text from specific page ranges
- Reads PDF metadata (title, author, creation date)
- Counts pages
- Preserves layout or extracts as plain flowing text
- Lists PDF structure (bookmarks/outline)

## Checking Tools are Available

```bash
which pdftotext && pdftotext -v 2>&1 | head -1
# Install: brew install poppler (macOS)
# Or: apt install poppler-utils (Linux)

# Available tools in poppler-utils:
# pdftotext, pdfinfo, pdfimages, pdftoppm, pdftohtml
```

## Extract Full Text

```bash
# Extract all text to stdout
pdftotext document.pdf -

# Extract to a text file
pdftotext document.pdf document.txt

# Extract preserving layout (useful for tables)
pdftotext -layout document.pdf -
```

## Extract Specific Pages

```bash
# Extract pages 1-5 only
pdftotext -f 1 -l 5 document.pdf -

# Extract a single page (page 3)
pdftotext -f 3 -l 3 document.pdf -

# Extract from page 10 to the end
pdftotext -f 10 document.pdf -
```

## Get PDF Metadata and Info

```bash
# Full metadata: title, author, pages, creation date, etc.
pdfinfo document.pdf

# Get just the page count
pdfinfo document.pdf | grep "Pages:" | awk '{print $2}'

# Get creator/author only
pdfinfo document.pdf | grep -E "(Author|Creator|Title):"
```

## Extract Images from PDF

```bash
# List all images embedded in the PDF
pdfimages -list document.pdf

# Extract all images to a directory
mkdir -p ./pdf_images
pdfimages document.pdf ./pdf_images/img
```

## Convert Pages to Images (for Vision AI)

```bash
# Convert page 1 to PNG at 150 DPI
pdftoppm -r 150 -f 1 -l 1 -png document.pdf /tmp/page

# Result: /tmp/page-1.png
# Convert multiple pages
pdftoppm -r 150 -f 1 -l 5 -png document.pdf /tmp/pages
```

## Handling Large PDFs Efficiently

```bash
# Check page count before extracting all
PAGES=$(pdfinfo document.pdf | grep "Pages:" | awk '{print $2}')
echo "PDF has $PAGES pages"

# For large PDFs, extract in sections
if [ "$PAGES" -gt 50 ]; then
  echo "Large PDF - extracting first 10 pages for preview"
  pdftotext -f 1 -l 10 document.pdf -
else
  pdftotext document.pdf -
fi
```

## Search Text Within a PDF

```bash
# Extract then search (fast for one-time lookup)
pdftotext document.pdf - | grep -n "search term"

# Extract with layout for better readability
pdftotext -layout document.pdf - | grep -i -A 2 -B 2 "invoice"
```

## PDF Outline (Table of Contents)

```bash
# Get bookmarks/outline structure
pdfinfo -meta document.pdf | grep -A 50 "<outline"
# Or use pdftocairo for better outline extraction
```

## Example Interactions

**User**: Read this PDF
**You**: *(checks page count, extracts text with pdftotext, presents content)*

**User**: What's on page 5 of this document?
**You**: *(runs `pdftotext -f 5 -l 5 document.pdf -`, presents extracted text)*

**User**: Who wrote this PDF?
**You**: *(runs `pdfinfo document.pdf`, extracts Author/Creator/Title fields)*

**User**: Search for "quarterly revenue" in this PDF
**You**: *(extracts full text, greps for term, shows surrounding context)*

## Safety Rules

- **Check** page count before extracting (warn if >200 pages - may be slow)
- **Never** attempt to modify or write back to PDF files
- **Confirm** before extracting all images from large PDFs
- **Report** if text extraction yields empty output (may be a scanned/image PDF)

## Handling Scanned PDFs (No Extractable Text)

If pdftotext returns empty or garbled output, the PDF may be scanned:

```bash
# Convert page to image, then use OCR
pdftoppm -r 300 -f 1 -l 1 -png scanned.pdf /tmp/scan_page
# Then pass /tmp/scan_page-1.png to vision AI or tesseract:
tesseract /tmp/scan_page-1.png stdout
```

## Best Practices

1. Always run `pdfinfo` first to know page count and check if it is encrypted
2. Use `-layout` flag when preserving columns and tables matters
3. For very long PDFs, extract relevant sections rather than everything
4. If extraction is empty, try converting to image and using vision/OCR
5. Strip leading/trailing whitespace from extracted text before presenting
