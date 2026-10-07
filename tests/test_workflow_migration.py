import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text


class WorkflowMigrationTest(unittest.TestCase):
    def test_preserves_modes_every_style_and_task_while_adding_storage(self):
        engine = create_engine("sqlite:///:memory:")
        migration_file = Path(__file__).parents[1] / "alembic/versions/f4a5b6c7d8e9_project_workflow.py"
        spec = importlib.util.spec_from_file_location("workflow_migration", migration_file)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
            connection.execute(text("CREATE TABLE projects (id INTEGER PRIMARY KEY, owner_id INTEGER, auto_generate BOOLEAN NOT NULL)"))
            connection.execute(text("CREATE TABLE global_prompts (id INTEGER PRIMARY KEY, owner_id INTEGER, title TEXT, body TEXT, prompt_type TEXT, is_active BOOLEAN)"))
            connection.execute(text("CREATE TABLE posting_tasks (id INTEGER PRIMARY KEY, status TEXT, posts_chain TEXT)"))
            connection.execute(text("INSERT INTO users VALUES (1), (2)"))
            connection.execute(text("INSERT INTO projects VALUES (1,1,1), (2,1,0), (3,2,1)"))
            connection.execute(text("INSERT INTO global_prompts VALUES (1,1,'First','A','virality',1), (2,1,'Second','B','virality',1), (3,2,'Inactive','C','virality',0)"))
            connection.execute(text("INSERT INTO posting_tasks VALUES (1,'queued','[\"existing\"]')"))
            with patch.object(migration, "op", Operations(MigrationContext.configure(connection))):
                migration.upgrade()
            rows = connection.execute(text("SELECT publication_mode, style_body FROM projects ORDER BY id")).all()
            self.assertEqual([r.publication_mode for r in rows], ["auto", "manual", "auto"])
            self.assertEqual(rows[0].style_body, "### First\nType: virality\nA\n\n### Second\nType: virality\nB")
            self.assertEqual(rows[1].style_body, rows[0].style_body)
            self.assertEqual(rows[2].style_body, "")
            self.assertEqual(connection.execute(text("SELECT status, posts_chain FROM posting_tasks")).one(), ("queued", '["existing"]'))
            self.assertEqual(connection.execute(text("SELECT COUNT(*) FROM posting_task_revisions")).scalar(), 0)
            self.assertEqual(connection.execute(text("SELECT onboarding_state FROM users WHERE id=1")).scalar(), None)
        engine.dispose()
