"""Startup failures for the MCP authorization server."""


class OAuthConfigurationError(RuntimeError):
    """OAuth was requested, but the process cannot start it safely."""


class OAuthTransactionAmbiguousError(RuntimeError):
    """Raised when a PostgreSQL connection drops during commit and outcome is unknown."""
