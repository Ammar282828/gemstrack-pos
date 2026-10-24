import Foundation

/// Made-up pictures for the label tests (made with Python's zlib), the same two as src/lib/test-fixtures/label-png.ts.
enum LabelFixtures {
    /// 8 × 2, RGBA: black, white, clear, grey 100, grey 200, black, black, white / the other way about.
    static let png8x2 = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAACCAYAAABllJ3tAAAAIklEQVR42mNgYGD4DwJAmiElJeX/iRMnQOz/cHGo5H9cCgEyzyDvGqF26AAAAABJRU5ErkJggg=="
    /// 24 × 20, RGB, r = 10x, g = 12y, b = x·y (all mod 256), one filter type (0 to 4) after another down the rows, Huffman codes in the file.
    static let png24x20 = "iVBORw0KGgoAAAANSUhEUgAAABgAAAAUCAIAAAAY12rUAAABu0lEQVR42q3Uq48TURSA8a+PmbbT2/csD8EYzAjWjADBMZiGsKYCBGMwNWtGgDm6IcHUYKprMNVHN5tgqkfXYKr5D2D2IiBZQbpt8hNHTM6984kLEEEMCaSQgcAUZpDDHApQWMASVrCGDRhsYQcl7OEANVy1qHa6erUIV62rhgauiQtwIa6Fa+M6uAjXxTlcD9fHDXBD3Ag3xk1wMe4C9wD3sMEjgrAehA2v6QVe6LW8ttfxIq/rOa9Xad7eqPpB6tCA5gmESIJYokQGqcSZPBZJpvJ0Jmkul3PJCnmhIgt5tZTpSq7WMtvIO5N8Kx92Mi/lei/FQT7VeF3FDk93xtjPuV/dIOx7A294N3YAIbSgDZ1jKJFGscaJJqmmmWaiMtXpTGe55nOdF1qo6kIXS12udLXW9UY3prbV7U53pZZ73R/0UONzFbt7ujPGfsv96nqjIPwahOPKf2NXT0OX24960L8j/mc2IhvEliR2mZpkdiWWT+16Zprbl7mtCvumZgv7vrRyZT/W9nNjv8z6W3uys2elvdzbm4O9r3FTHTo83Rljf+TIuqM/dYNw4sXexbGxJzCEEYz9/NdveFWFRccq0CEAAAAASUVORK5CYII="
}
