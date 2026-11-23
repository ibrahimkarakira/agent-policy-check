# Security policy

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub's private vulnerability reporting: the **Security** tab of this repository, then **Report a vulnerability**.

Include the version (`agent-policy-check --version`), the command you ran and a synthetic config that reproduces the problem. Never send a real config that holds secrets.

## What counts

This tool reads agent configuration files and reports what they enforce. The most serious bug it can have is a false **pass**: reporting that a limit is enforced when it is not. Treat that as a security issue and report it privately. Code execution, path traversal or secret leakage while reading config files are in scope too.

## Supported versions

Only the latest release gets fixes until v1.0.
