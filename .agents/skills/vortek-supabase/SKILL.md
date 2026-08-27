---
name: vortek-supabase
description: Use for Vortek tasks involving Supabase, PostgreSQL, database schema, migrations, RLS, Auth, Storage, Studio, database credentials, logs, or the live Supabase stack. Vortek uses self-hosted Supabase, never Supabase Cloud operational workflows.
---

# Vortek Supabase

Use this skill only for Supabase/PostgreSQL work related to Vortek.

## Environment

Vortek uses a self-hosted Supabase instance.

Known operational environment:

- Supabase host: `192.168.1.160`
- Stack directory: `/opt/supabase-vortek/supabase-project`
- Stack environment: `/opt/supabase-vortek/supabase-project/.env`
- Public Studio/API infrastructure is self-hosted.

Do not convert this workflow into Supabase Cloud.

Do not require or ask for:

- Supabase Cloud project refs;
- Supabase Cloud dashboard access;
- Supabase Cloud personal access tokens;
- Supabase Cloud MCP authentication

unless the user explicitly says the project architecture has changed and current repository evidence confirms it.

## Mandatory workflow

For every Vortek Supabase task:

1. Read the relevant Vortek code, schema, migrations, and configuration first.
2. Identify exactly which Supabase/PostgreSQL feature is involved.
3. Consult the current official Supabase documentation for that exact feature.
4. Consult current official PostgreSQL documentation when behavior depends on PostgreSQL itself.
5. When live environment inspection is necessary and authorized access is available, inspect the self-hosted stack on `192.168.1.160`.
6. Compare repository state, live stack state, and official documentation before concluding.
7. Fix the root cause with the smallest safe change.
8. Validate only the affected behavior.

## Live stack

When credentials, connection details, Studio configuration, database access, or stack configuration are needed, inspect the existing authorized server configuration before asking the user.

Relevant location:

`/opt/supabase-vortek/supabase-project`

The `.env` may contain sensitive values such as database passwords, dashboard credentials, API keys, JWT secrets, and connection details.

You may inspect authorized secret configuration when required for the task.

Never:

- print secret values to the user;
- copy secrets into source code;
- commit secrets;
- expose secrets in logs or reports.

If a required value cannot be found through authorized repository/server configuration, ask only for the smallest missing information.

## Database changes

Before changing the database, inspect as relevant:

- current schema;
- migrations;
- existing data;
- indexes;
- constraints;
- foreign keys;
- functions;
- triggers;
- RLS policies;
- grants;
- code that reads the data;
- code that writes the data;
- external integrations depending on the data.

Prefer the existing source of truth.

Do not create duplicate fields or tables to avoid fixing ownership or state logic.

For destructive changes, consider backup, migration path, compatibility, rollback, and reprocessing.

## RLS and security

For RLS, Auth, permissions, service-role usage, or exposed data:

1. identify the actual caller;
2. identify which credentials/role it uses;
3. inspect current policies and grants;
4. verify expected behavior against official Supabase/PostgreSQL documentation;
5. apply the smallest rule change that produces the intended authorization.

Never disable RLS globally merely to make an operation work.

Never move privileged credentials to client-side code.

## Self-hosted differences

Do not assume features of the managed Supabase platform exist in self-hosted Vortek.

Verify support before recommending platform-management features, managed backups, branching, project APIs, hosted dashboard workflows, or other cloud-specific functionality.

When official documentation describes both hosted and self-hosted behavior, follow the self-hosted path.

## Final report

Keep the response short.

Normally report:

- cause or finding;
- evidence;
- change made or recommended;
- validation actually performed;
- remaining risk only when relevant.

Never claim a migration, SQL command, server operation, test, or validation was executed unless it actually was.
