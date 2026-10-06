"""Knowledge files carry the verified scripts and delivery byte for byte, and the exact refusals."""
import json
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from libinsight_analysis import request  # noqa: E402
import synthetic  # noqa: E402

KNOWLEDGE = os.path.join(synthetic.PACK, "knowledge")


def read(path):
    with open(path, encoding="utf-8") as stream:
        return stream.read()


def embedded(doc, name, language):
    found = re.search(r"<!-- BEGIN %s -->\n```%s\n(.*?)```\n<!-- END %s -->" % (
        re.escape(name), language, re.escape(name)), read(os.path.join(KNOWLEDGE, doc)), re.S)
    if not found:
        raise AssertionError("%s has no embedded %s" % (doc, name))
    return found.group(1)


class Knowledge(unittest.TestCase):
    def test_example_embeds_the_verified_script_and_delivery(self):
        self.assertEqual(embedded("example-custom-analysis.md", "inv_drive_delay.py", "python"),
                         read(synthetic.EXAMPLE_SCRIPT))
        shown = json.loads(embedded("example-custom-analysis.md", "delivery.json", "json"))
        with open(os.path.join(synthetic.FIXTURE, "analysis-result.json"), encoding="utf-8") as stream:
            actual = json.load(stream)
        self.assertEqual(actual["code"]["main"]["text"], read(synthetic.EXAMPLE_SCRIPT))
        actual["code"]["main"]["text"] = shown["code"]["main"]["text"]
        self.assertEqual(shown, actual)

    def test_playbook_embeds_the_live_script_and_the_licence_refusal(self):
        live = os.path.join(synthetic.TESTS, "fixtures", "qualib-live", "analysis", "qualib_inv_tables.py")
        self.assertEqual(embedded("qualib-api-playbook.md", "qualib_inv_tables.py", "python"), read(live))
        playbook = read(os.path.join(KNOWLEDGE, "qualib-api-playbook.md")).replace("\n  ", " ")
        self.assertIn(request.XTOP_MODE_MESSAGE, playbook)

    def test_every_declared_knowledge_file_exists(self):
        contract = read(os.path.join(synthetic.PACK, "contract.yml"))
        for name in re.findall(r"^- file: (\S+)$", contract, re.M):
            self.assertTrue(os.path.isfile(os.path.join(KNOWLEDGE, name)), name)


if __name__ == "__main__":
    unittest.main()
