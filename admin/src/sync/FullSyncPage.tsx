import React from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Sync } from "@mui/icons-material";
import { Title, useNotify } from "react-admin";

import { getAuthHeaders } from "../authProvider";
import { API_BASE } from "../env";

type SyncFailure = {
  sha256: string;
  url: string;
  reason: string;
};

type SyncResult = {
  source: string;
  synced: number;
  skipped: number;
  ownersAdded: number;
  failed: number;
  failures: SyncFailure[];
};

function getApiURL(path: string) {
  return API_BASE + path;
}

async function parseSyncResponse(response: Response) {
  const text = await response.text();
  const fallback = response.headers.get("X-Reason") || text || `Request failed with ${response.status}`;

  if (!text) {
    if (!response.ok) throw new Error(fallback);
    throw new Error("Sync completed without a response body");
  }

  let body: SyncResult;
  try {
    body = JSON.parse(text) as SyncResult;
  } catch {
    throw new Error(fallback);
  }

  if (!response.ok) throw new Error(fallback);
  return body;
}

export default function FullSyncPage() {
  const notify = useNotify();
  const [remoteUrl, setRemoteUrl] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SyncResult | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(getApiURL("/sync/full"), {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: remoteUrl.trim(),
          password,
        }),
      });

      const syncResult = await parseSyncResponse(response);

      setResult(syncResult);
      setPassword("");

      if (syncResult.failed > 0) notify(`Sync finished with ${syncResult.failed} failed blobs`, { type: "warning" });
      else notify(`Synced ${syncResult.synced} blobs from ${syncResult.source}`, { type: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      setError(message);
      notify(message, { type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box maxWidth={900}>
      <Title title="Full Sync" />

      <Card>
        <CardContent>
          <Stack component="form" spacing={3} onSubmit={onSubmit}>
            <Box>
              <Typography variant="h5">Full Sync</Typography>
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                Pull every missing blob from another Blossom instance. The remote instance must have the admin dashboard
                enabled, and the remote admin username defaults to admin.
              </Typography>
            </Box>

            <TextField
              label="Remote server URL"
              value={remoteUrl}
              onChange={(event) => setRemoteUrl(event.target.value)}
              placeholder="https://media.example.com"
              required
              fullWidth
              autoComplete="url"
            />

            <TextField
              label="Remote admin password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              fullWidth
              autoComplete="current-password"
            />

            {error && <Alert severity="error">{error}</Alert>}

            <Stack direction="row" spacing={2} alignItems="center">
              <Button type="submit" variant="contained" startIcon={submitting ? <CircularProgress size={18} /> : <Sync />} disabled={submitting}>
                {submitting ? "Syncing..." : "Start full sync"}
              </Button>
              <Typography color="text.secondary">Only one full sync can run at a time on this instance.</Typography>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {result && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Stack spacing={2}>
              <Box>
                <Typography variant="h6">Last Result</Typography>
                <Typography color="text.secondary" sx={{ mt: 1 }}>
                  Source: {result.source}
                </Typography>
              </Box>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip color="success" label={`Synced ${result.synced}`} />
                <Chip color="default" label={`Skipped ${result.skipped}`} />
                <Chip color="info" label={`Owners added ${result.ownersAdded}`} />
                <Chip color={result.failed > 0 ? "warning" : "success"} label={`Failed ${result.failed}`} />
              </Stack>

              {result.failures.length > 0 && (
                <Stack spacing={1}>
                  <Typography variant="subtitle1">Failures</Typography>
                  {result.failures.map((failure) => (
                    <Alert key={`${failure.sha256}-${failure.url}`} severity="warning">
                      <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                        {failure.sha256}
                      </Typography>
                      <Typography variant="body2">{failure.reason}</Typography>
                    </Alert>
                  ))}
                </Stack>
              )}
            </Stack>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}