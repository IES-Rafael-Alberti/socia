import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


generator = load("guide_generator", ROOT / "scripts" / "generate_guide.py")
renderer = load("guide_renderer", ROOT / "assets" / "render.py")


def sample_content():
    return {
        "caseTitle": "Caso de prueba",
        "coverTitle": "Caso de prueba",
        "context": "Contexto",
        "learningObjectives": ["Aprender una decisión"],
        "conclusion": "Conclusión",
        "phases": [{
            "title": "Triaje", "role": "Analista", "tool": "Herramienta",
            "introduction": "La herramienta permite acotar el caso.", "summary": "Tomar una decisión",
            "transcriptRefs": ["00:10-00:20"],
            "steps": [{
                "title": "Revisar la alerta",
                "body": ["Revisar los campos.", "La alerta contiene datos suficientes."],
                "transcriptRefs": ["00:12-00:18"],
            }],
        }],
    }


class DurationTest(unittest.TestCase):
    def test_prefers_active_duration(self):
        result = generator.active_duration({
            "duration": 1_254_547,
            "videoDuration": "18:42",
            "videoCapture": {"activeDurationMs": 1_122_830, "pausedDurationMs": 131_238},
        })
        self.assertEqual(result, ("18:42", "videoCapture.activeDurationMs", None))

    def test_uses_video_duration_before_total(self):
        self.assertEqual(generator.active_duration({"videoDuration": "18:42", "duration": 99})[0], "18:42")

    def test_subtracts_pauses(self):
        self.assertEqual(
            generator.active_duration({"duration": 1_254_000, "videoCapture": {"pausedDurationMs": 132_000}})[0],
            "18:42",
        )

    def test_total_duration_has_warning(self):
        duration, source, warning = generator.active_duration({"duration": 60_000})
        self.assertEqual((duration, source), ("1:00", "duration"))
        self.assertIsNotNone(warning)


class TemplateTest(unittest.TestCase):
    def test_dynamic_blocks_and_optional_content(self):
        content = sample_content()
        content["phases"][0]["steps"][0]["conditional"] = {
            "condition": "hay datos", "whenTrue": "seguir", "whenFalse": "documentar",
        }
        content["phases"][0]["steps"][0]["result"] = "Dos eventos"
        brand = json.loads((ROOT / "brands" / "socia" / "brand.json").read_text())
        phases, rows, count = generator.build_phases(content, Path("/"), Path("/tmp"))
        document = generator.fill_template(content, brand, "1:00", phases, rows, count, "toc-new-page")
        self.assertIn("Revisar los campos", document)
        self.assertIn("Resultado:", document)
        self.assertIn("Decisión condicional", document)
        self.assertIn("toc-new-page", document)
        self.assertNotRegex(document, generator.PLACEHOLDER)

    def test_minimal_step_does_not_add_empty_sections(self):
        content = sample_content()
        content.pop("learningObjectives")
        content["phases"][0].pop("introduction")
        content["phases"][0]["steps"][0]["body"] = "Abrir el caso y revisar sus datos."
        brand = json.loads((ROOT / "brands" / "socia" / "brand.json").read_text())
        phases, rows, count = generator.build_phases(content, Path("/"), Path("/tmp"))
        document = generator.fill_template(content, brand, "1:00", phases, rows, count, "")
        self.assertNotIn("Objetivos de aprendizaje", document)
        self.assertNotIn("Objetivo:", document)
        self.assertNotIn("Resultado:", document)
        self.assertNotIn("Evidencia que conviene guardar:", document)

    def test_cover_omits_empty_case_subtitle(self):
        content = sample_content()
        brand = json.loads((ROOT / "brands" / "socia" / "brand.json").read_text())
        phases, rows, count = generator.build_phases(content, Path("/"), Path("/tmp"))
        document = generator.fill_template(content, brand, "1:00", phases, rows, count, "")
        self.assertNotIn('class="case-subtitle"', document)

    def test_quality_warnings_detect_repetitive_case_labels(self):
        content = sample_content()
        content["phases"][0]["steps"][0]["body"] = [
            "En este caso revisamos la alerta.",
            "En este caso buscamos accesos.",
            "En este caso bloqueamos la dirección.",
        ]
        warnings = generator.content_quality_warnings(content)
        self.assertTrue(any("En este caso" in warning for warning in warnings))

    def test_quality_warnings_ignore_captions_context_and_inline_uses(self):
        content = sample_content()
        content["context"] = "En este caso. En este caso. En este caso."
        content["phases"][0]["steps"][0]["body"] = (
            "Revisamos la alerta. En este caso hay una IP de origen. "
            "En este caso también consta el destino. En este caso falta el usuario."
        )
        content["phases"][0]["steps"][0]["figure"] = {
            "source": "captura.png",
            "caption": "En este caso. En este caso. En este caso.",
        }
        warnings = generator.content_quality_warnings(content)
        self.assertFalse(any("En este caso" in warning for warning in warnings))

    def test_quality_warnings_include_auxiliary_step_prose(self):
        content = sample_content()
        step = content["phases"][0]["steps"][0]
        step["result"] = "En este caso no hay accesos correctos."
        step["note"] = "En este caso ampliamos el intervalo."
        step["evidence"] = "En este caso guardamos la consulta."
        warnings = generator.content_quality_warnings(content)
        self.assertTrue(any("abre 3 párrafos" in warning for warning in warnings))

    def test_quality_warnings_include_conditional_prose(self):
        content = sample_content()
        content["phases"][0]["steps"][0]["conditional"] = {
            "condition": "En este caso encontramos actividad",
            "whenTrue": "En este caso ampliamos el análisis.",
            "whenFalse": "En este caso documentamos la ausencia.",
        }
        warnings = generator.content_quality_warnings(content)
        self.assertTrue(any("abre 3 párrafos" in warning for warning in warnings))

    def test_quality_warnings_detect_joined_lines(self):
        content = sample_content()
        content["phases"][0]["steps"][0]["body"] = (
            "En este caso revisamos la alerta.\n"
            "En este caso buscamos accesos.\n"
            "En este caso bloqueamos la dirección."
        )
        warnings = generator.content_quality_warnings(content)
        self.assertTrue(any("abre 3 párrafos" in warning for warning in warnings))

    def test_body_list_preserves_block_html(self):
        result = generator.body_html([
            "Texto normal.",
            '<div class="note-box">Nota</div>',
            "<ul><li>Elemento</li></ul>",
        ])
        self.assertEqual(
            result,
            '<p>Texto normal.</p><div class="note-box">Nota</div><ul><li>Elemento</li></ul>',
        )
        self.assertNotIn("<p><div", result)
        self.assertNotIn("<p><ul", result)

    def test_quality_warnings_require_transcript_traceability(self):
        content = sample_content()
        content["phases"][0].pop("transcriptRefs")
        content["phases"][0]["steps"][0].pop("transcriptRefs")
        warnings = generator.content_quality_warnings(content)
        self.assertEqual(sum("transcripción" in warning for warning in warnings), 2)

    def test_toc_moves_only_when_it_spills_from_context_page(self):
        short = {"elements": {"context-start": 2, "toc-start": 2, "toc-end": 2}}
        long = {"elements": {"context-start": 2, "toc-start": 2, "toc-end": 3}}
        already_separate = {"elements": {"context-start": 2, "toc-start": 3, "toc-end": 4}}
        self.assertFalse(generator.toc_needs_new_page(short))
        self.assertTrue(generator.toc_needs_new_page(long))
        self.assertFalse(generator.toc_needs_new_page(already_separate))


class TranscriptExtractorTest(unittest.TestCase):
    def test_formats_segments_with_timestamps(self):
        module = load("transcript_extractor", ROOT / "scripts" / "extract_transcript.py")
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "transcription.json"
            source.write_text(json.dumps({
                "segments": [
                    {"start": 5.2, "end": 8.9, "text": "  Primera   frase "},
                    {"start": 65, "end": 70, "text": "Segunda frase"},
                ]
            }))
            result = module.extract(source)
        self.assertEqual(result, "[00:05-00:08] Primera frase\n[01:05-01:10] Segunda frase\n")

@unittest.skipUnless(os.environ.get("RUN_PDF_RENDER_TESTS") == "1", "prueba de renderizado opcional")
class LayoutIntegrationTest(unittest.TestCase):
    def render_probe(self, step_count):
        content = sample_content()
        original = content["phases"][0]["steps"][0]
        content["phases"][0]["steps"] = [dict(original, title=f"Paso de prueba {index}") for index in range(step_count)]
        brand = json.loads((ROOT / "brands" / "socia" / "brand.json").read_text())
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            phases, rows, count = generator.build_phases(content, target, target)
            document = generator.fill_template(content, brand, "1:00", phases, rows, count, "")
            html_path = target / "guide.html"
            pdf_path = target / "guide.pdf"
            probe_path = target / "probe.json"
            html_path.write_text(document, encoding="utf-8")
            renderer.render_html(html_path, pdf_path, probe_path)
            return json.loads(probe_path.read_text())

    def test_short_toc_shares_the_context_page(self):
        probe = self.render_probe(1)
        elements = probe["elements"]
        self.assertEqual(elements["context-start"], elements["toc-start"])
        self.assertEqual(elements["toc-start"], elements["toc-end"])

    def test_long_toc_starts_on_a_new_page_or_triggers_second_pass(self):
        probe = self.render_probe(55)
        elements = probe["elements"]
        valid = elements["toc-start"] != elements["context-start"] or generator.toc_needs_new_page(probe)
        self.assertTrue(valid)
        self.assertGreaterEqual(elements["toc-end"], elements["toc-start"])


class RendererTest(unittest.TestCase):
    def test_macos_environment_keeps_existing_paths(self):
        with mock.patch.object(renderer.sys, "platform", "darwin"), mock.patch.object(
            renderer, "macos_library_dirs", return_value=[Path("/opt/homebrew/lib")]
        ):
            env = renderer.renderer_environment({"DYLD_FALLBACK_LIBRARY_PATH": "/custom"})
        self.assertEqual(env["DYLD_FALLBACK_LIBRARY_PATH"], "/opt/homebrew/lib:/custom")

    def test_uv_fallback_is_isolated(self):
        with mock.patch.object(renderer.shutil, "which", return_value="/usr/bin/uv"):
            commands = renderer.render_commands(Path("worker.py"), Path("in.html"), Path("out.pdf"), None)
        self.assertIn("--isolated", commands[1])
        self.assertIn("weasyprint==69.0", commands[1])


class CleanupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.recording = self.root / "recording"
        self.recording.mkdir()
        (self.recording / "metadata.json").write_text(
            json.dumps({"videoCapture": {"activeDurationMs": 60_000}}), encoding="utf-8"
        )

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def fake_render(html_path, pdf_path, probe_path):
        pdf_path.write_bytes(b"%PDF-test")
        probe_path.write_text(json.dumps({
            "pageCount": 2,
            "elements": {"context-start": 2, "toc-start": 2, "toc-end": 2},
        }))

    def test_cleanup_after_success(self):
        output = self.root / "result.pdf"
        with mock.patch.object(generator, "render", side_effect=self.fake_render):
            generator.generate(self.recording, sample_content(), "socia", output, False)
        self.assertTrue(output.is_file())
        self.assertEqual(list(self.root.glob(".guide-build-*")), [])

    def test_cleanup_after_failure(self):
        with mock.patch.object(generator, "render", side_effect=RuntimeError("fallo")):
            with self.assertRaises(RuntimeError):
                generator.generate(self.recording, sample_content(), "socia", self.root / "result.pdf", False)
        self.assertEqual(list(self.root.glob(".guide-build-*")), [])


if __name__ == "__main__":
    unittest.main()
