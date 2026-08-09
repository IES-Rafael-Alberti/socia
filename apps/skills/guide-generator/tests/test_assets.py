from pathlib import Path
import re
import shutil
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = (ROOT / "assets" / "template.html").read_text(encoding="utf-8")
STYLES = (ROOT / "assets" / "styles.css").read_text(encoding="utf-8")


class GuideAssetsTest(unittest.TestCase):
    def test_brand_override_follows_base_styles(self):
        self.assertLess(TEMPLATE.index("{{INLINE_CSS}}"), TEMPLATE.index("{{BRAND_PRIMARY}}"))

    def test_cover_selectors_match_template(self):
        self.assertIn('class="cover-page"', TEMPLATE)
        self.assertIn(".cover-page h1", STYLES)
        self.assertIn(".cover-page .subtitle", STYLES)
        self.assertNotIn(".cover h1", STYLES)

    def test_context_and_toc_can_share_a_page(self):
        self.assertNotIn(".toc { page-break-before: always; }", STYLES)
        self.assertRegex(
            STYLES,
            r"\.toc\s*\{[^}]*page-break-inside:\s*avoid;[^}]*\}",
        )
        self.assertLess(TEMPLATE.index('class="context-box"'), TEMPLATE.index('class="toc"'))

    def test_toc_phases_and_steps_have_page_groups(self):
        self.assertIn('class="toc-phase"', TEMPLATE)
        self.assertIn(".toc-phase { page-break-inside: avoid; }", STYLES)
        self.assertIn('class="guide-step"', TEMPLATE)
        self.assertIn(".guide-step { page-break-inside: avoid; }", STYLES)

    def test_template_renders_with_socia_brand(self):
        try:
            from weasyprint import HTML
        except (ImportError, OSError) as error:
            self.skipTest(f"weasyprint cannot run in this environment: {error}")

        replacements = {
            "{{INLINE_CSS}}": STYLES,
            "{{BRAND_PRIMARY}}": "#e93456",
            "{{BRAND_PRIMARY_DARK}}": "#c42847",
            "{{BRAND_TINT}}": "#fff5f7",
            "{{BRAND_DARK}}": "#222220",
            "{{BRAND_MUTED}}": "#9ca3af",
            "{{BRAND_BORDER}}": "#e5e5e5",
            "{{BRAND_PAGE_FOOTER}}": "SOCIA · Ciberseguridad",
            "{{SCREENSHOT_FILENAME}}": "test.png",
        }
        html = TEMPLATE
        for token, value in replacements.items():
            html = html.replace(token, value)
        html = re.sub(r"{{[^}]+}}", "Contenido de prueba", html)

        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir)
            (output / "assets").mkdir()
            (output / "images").mkdir()
            imago = ROOT / "brands" / "socia" / "imago.png"
            sello = ROOT / "brands" / "socia" / "sello.png"
            shutil.copy2(imago, output / "assets" / "imago.png")
            shutil.copy2(sello, output / "assets" / "sello.png")
            shutil.copy2(imago, output / "images" / "test.png")
            html_path = output / "guide.html"
            pdf_path = output / "guide.pdf"
            html_path.write_text(html, encoding="utf-8")
            HTML(filename=str(html_path), base_url=str(output)).write_pdf(str(pdf_path))
            self.assertGreater(pdf_path.stat().st_size, 10_000)


if __name__ == "__main__":
    unittest.main()
