-- Les questions écrites avant les types de question (ADR 0015) sont toutes des QCM.
UPDATE "quizzes" SET "questions" = (
	SELECT jsonb_agg(question || '{"kind": "choice"}'::jsonb ORDER BY position)
	FROM jsonb_array_elements("questions") WITH ORDINALITY AS item(question, position)
);
--> statement-breakpoint
UPDATE "games" SET "questions" = (
	SELECT jsonb_agg(question || '{"kind": "choice"}'::jsonb ORDER BY position)
	FROM jsonb_array_elements("questions") WITH ORDINALITY AS item(question, position)
);
