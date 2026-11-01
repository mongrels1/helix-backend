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
