require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const app = express();

const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(",") || [],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(cors());
app.use(express.json());

// Configuration
const AZURE_ORG = "p365Cloud";
const AZURE_PROJECT = "AccountX";
const AZURE_PAT = process.env.AZURE_PAT;
const PORT = 3000;

const REPOS = [
  "account-core",
  "procurement-core",
  "admin-node",
  "account-node",
  "procurement-node",
  "account-react",
  "procurement-react",
];

// Azure DevOps API base URL
const AZURE_API_BASE = `https://dev.azure.com/${AZURE_ORG}/${AZURE_PROJECT}/_apis`;

// Helper function to make Azure API calls
async function azureApiCall(endpoint, params = {}) {
  const url = `${AZURE_API_BASE}${endpoint}`;
  const auth = Buffer.from(`:${AZURE_PAT}`).toString("base64");

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      params: {
        "api-version": "7.0",
        ...params,
      },
    });
    return response.data;
  } catch (error) {
    console.error(
      `API Error: ${endpoint}`,
      error.response?.data || error.message,
    );
    throw error;
  }
}

// Fetch PRs from a single repo
async function fetchPRsFromRepo(repoId, targetBranch, dateFilter) {
  try {
    const data = await azureApiCall(
      `/git/repositories/${repoId}/pullrequests`,
      {
        $top: 20,
        "searchCriteria.status": "completed",
        "searchCriteria.targetRefName": `refs/heads/${targetBranch}`,
      },
    );

    console.log(`    Total PRs in ${repoId}: ${data.value.length}`);

    // Filter PRs - MUST match both criteria:
    // 1. Target branch matches
    // 2. Title contains date in [MM/DD/YYYY] format
    return data.value.filter((pr) => pr.title.includes(`[${dateFilter}]`));
  } catch (error) {
    console.error(`Error fetching PRs from repo ${repoId}:`, error.message);
    return [];
  }
}

// Fetch commits for a specific PR
async function fetchPRCommits(repoId, prId) {
  try {
    const data = await azureApiCall(
      `/git/repositories/${repoId}/pullrequests/${prId}/commits`,
    );

    return data.value.map((commit) => ({
      commitId: commit.commitId,
      author: commit.author.name,
      email: commit.author.email,
      comment: commit.comment,
      authoredDate: commit.author.date,
    }));
  } catch (error) {
    console.error(`Error fetching commits for PR ${prId}:`, error.message);
    return [];
  }
}

// Main endpoint
app.get("/api/prs-with-commits", async (req, res) => {
  try {
    const targetBranch = req.query.target;
    const dateFilter = req.query.date;

    if (!targetBranch || !dateFilter) {
      return res.status(400).json({
        success: false,
        error: "Both parameters are REQUIRED: ?target=branch&date=MM/DD/YYYY",
        example: "?target=ent-uat-v2&date=05/05/2026",
        timestamp: new Date().toISOString(),
      });
    }

    const results = [];

    for (const repoId of REPOS) {
      const prs = await fetchPRsFromRepo(repoId, targetBranch, dateFilter);

      for (const pr of prs) {
        const commits = await fetchPRCommits(repoId, pr.pullRequestId);

        results.push({
          repo: repoId,
          pr: {
            id: pr.pullRequestId,
            title: pr.title,
            status: pr.status,
            createdBy: pr.createdBy.displayName,
            creationDate: pr.creationDate,
            sourceRefName: pr.sourceRefName,
            targetRefName: pr.targetRefName,
          },
          commits: commits,
          commitCount: commits.length,
        });
      }
    }

    res.json({
      success: true,
      searchCriteria: {
        targetBranch: targetBranch,
        dateInTitle: `[${dateFilter}]`,
      },
      totalPRsFound: results.length,
      data: results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});

server.on("error", (err) => {
  console.error("Server error:", err);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  process.exit(1);
});
