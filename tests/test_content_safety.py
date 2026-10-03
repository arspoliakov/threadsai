import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.ai_engine.safety import ContentSafetyError, safe_completion


def response(text, finish="stop"):
    return SimpleNamespace(choices=[SimpleNamespace(
        message=SimpleNamespace(content=text), finish_reason=finish)])


class ContentSafetyTests(unittest.IsolatedAsyncioTestCase):
    def client(self, responses):
        return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(
            create=AsyncMock(side_effect=responses))))

    async def test_blocked_input_never_reaches_generator(self):
        client = self.client([response('{"decision":"block"}')])
        with self.assertRaises(ContentSafetyError) as error:
            await safe_completion(client, messages=[{"role":"user", "content":"unsafe request"}])
        self.assertFalse(error.exception.unavailable)
        self.assertEqual(client.chat.completions.create.await_count, 1)

    async def test_unsafe_output_is_not_returned(self):
        client = self.client([response('{"decision":"allow"}'), response("unsafe output"),
                              response('{"decision":"block"}')])
        with self.assertRaises(ContentSafetyError):
            await safe_completion(client, messages=[{"role":"user", "content":"normal request"}])

    async def test_invalid_or_unavailable_moderation_fails_closed(self):
        for result in [RuntimeError("upstream confidential text"), response('{}'),
                       response('{"decision":"allow"}', "length")]:
            with self.subTest(result=type(result).__name__):
                client = self.client([result])
                with self.assertRaises(ContentSafetyError) as error:
                    await safe_completion(client, messages=[{"role":"user", "content":"private input"}])
                self.assertTrue(error.exception.unavailable)
                self.assertNotIn("confidential", str(error.exception))
                self.assertEqual(client.chat.completions.create.await_count, 1)

    async def test_allowed_generation_preserves_result_and_checks_project_instructions(self):
        generated = response("ordinary marketing post")
        client = self.client([response('{"decision":"allow"}'), generated,
                              response('{"decision":"allow"}')])
        result = await safe_completion(client, messages=[{"role":"system", "content":"project instructions"}])
        self.assertIs(result, generated)
        calls = client.chat.completions.create.await_args_list
        self.assertIn("project instructions", calls[0].kwargs["messages"][1]["content"])
        self.assertIn("ordinary marketing post", calls[2].kwargs["messages"][1]["content"])
