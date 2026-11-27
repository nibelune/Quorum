CREATE TABLE "game_answers" (
	"game_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"choice_index" integer NOT NULL,
	"response_ms" integer NOT NULL,
	"points" integer NOT NULL,
	CONSTRAINT "game_answers_game_id_question_id_team_id_pk" PRIMARY KEY("game_id","question_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "game_players" (
	"game_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"nickname" text NOT NULL,
	"team_id" uuid NOT NULL,
	CONSTRAINT "game_players_game_id_player_id_pk" PRIMARY KEY("game_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "game_teams" (
	"game_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"score" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "game_teams_game_id_team_id_pk" PRIMARY KEY("game_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"quiz_id" uuid,
	"title" text NOT NULL,
	"mode" text NOT NULL,
	"questions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "game_answers" ADD CONSTRAINT "game_answers_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_teams" ADD CONSTRAINT "game_teams_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "games_owner_id_index" ON "games" USING btree ("owner_id");