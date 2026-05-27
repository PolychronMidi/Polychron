# _lib/

Shared test helpers consumed by specs under tools/HME/tests/specs/.
helpers.py is the canonical home for purge_modules, with_project_root,
with_home_settings, write_file, init_git_repo, stage_file,
assert_class_shape, and smoke_run. Specs import what they need with
one line.
