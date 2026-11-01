"""LP12: a stacked fraction in a PDF table stays a fraction; repeated footers go."""
import extractors


def test_fraction_cell_and_rows():
    assert extractors._cell("1\n2") == "1/2"
    assert extractors._cell(" 1 \n 8 ") == "1/8"
    assert extractors._cell("Serving Size\n(in ounces)") == "Serving Size (in ounces)"
    assert extractors._row(["10", "", "", ""]) == "10 |"
    assert extractors._row(["", "304"]) == "| 304"


def test_boilerplate_is_lines_on_three_pages():
    pages = ["Grade 7 Unit 3\nQ1", "Grade 7 Unit 3\nQ2", "Grade 7 Unit 3\nQ3 | x\n[table]"] + ["[table]", "[table]"]
    drop = extractors._boilerplate(pages)
    assert "Grade 7 Unit 3" in drop
    assert "[table]" not in drop


def _pdf_with(tmp_path, draw):
    canvas = __import__("pytest").importorskip("reportlab.pdfgen.canvas")
    path = tmp_path / "w.pdf"
    c = canvas.Canvas(str(path), pagesize=(612, 792))
    c.setFont("Helvetica", 12)
    draw(c)
    c.save()
    return str(path)


def test_built_up_fraction_in_running_text(tmp_path):
    def draw(c):
        c.drawString(72, 700, "1. Pour")
        c.setFont("Helvetica", 9)
        c.drawString(122, 707, "3")
        c.line(120, 703, 129, 703)
        c.drawString(122, 694, "4")
        c.setFont("Helvetica", 12)
        c.drawString(136, 700, "cup of water into the jug.")
    text = extractors.extract_text(_pdf_with(tmp_path, draw), "w.pdf")
    assert "Pour 3/4 cup of water" in text


def test_a_column_of_numbers_is_not_a_fraction(tmp_path):
    def draw(c):
        c.drawString(72, 700, "Pounds")
        c.drawString(80, 686, "3")
        c.drawString(80, 672, "6")
        c.drawString(80, 658, "10")
    text = extractors.extract_text(_pdf_with(tmp_path, draw), "w.pdf")
    assert "3/6" not in text and "6/10" not in text
    assert "3" in text and "10" in text
