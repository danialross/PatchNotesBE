require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();

app.use(express.json());

// Configuration
const AZURE_ORG = "p365Cloud"; // Replace with your Azure DevOps org
const AZURE_PROJECT = "AccountX"; // Replace with your project
const AZURE_PAT = process.env.AZURE_PAT; // Use env var for security
const PORT = 3000;

// Your 7 repositories
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
async function fetchPRsFromRepo(
  repoId,
  sourceBranch,
  targetBranch,
  dateFilter,
) {
  try {
    // Get ALL PRs - no status filter
    const data = await azureApiCall(
      `/git/repositories/${repoId}/pullrequests`,
      {
        $top: 20,
        "searchCriteria.status": "completed",
        "searchCriteria.sourceRefName": `refs/heads/${sourceBranch}`,
        "searchCriteria.targetRefName": `refs/heads/${targetBranch}`,
      },
    );

    console.log(`    Total PRs in ${repoId}: ${data.value.length}`);

    // Filter PRs - MUST match ALL 3 criteria:
    // 1. Source branch matches
    // 2. Target branch matches
    // 3. Title contains date in [MM/DD/YYYY] format
    return data.value.filter((pr) => {
      const titleMatch = pr.title.includes(`[${dateFilter}]`);
      return titleMatch;
    });
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
    // All 3 parameters are REQUIRED - no defaults
    const sourceBranch = req.query.source;
    const targetBranch = req.query.target;
    const dateFilter = req.query.date;

    if (!sourceBranch || !targetBranch || !dateFilter) {
      return res.status(400).json({
        success: false,
        error:
          "All three parameters are REQUIRED: ?source=branch&target=branch&date=MM/DD/YYYY",
        example: "?source=ar-mc&target=ent-uat-v2&date=05/05/2026",
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`\n=== Search Criteria ===`);
    console.log(`Source Branch: ${sourceBranch}`);
    console.log(`Target Branch: ${targetBranch}`);
    console.log(`Date in Title: [${dateFilter}]`);
    console.log(`=== Searching all 7 repos ===\n`);

    const results = [];

    // Fetch PRs from all repos
    for (const repoId of REPOS) {
      const logMsg = `Searching ${repoId}: [${sourceBranch} -> ${targetBranch}] with date [${dateFilter}]`;
      console.log(logMsg);

      const prs = await fetchPRsFromRepo(
        repoId,
        sourceBranch,
        targetBranch,
        dateFilter,
      );

      if (prs.length > 0) {
        console.log(`  ✓ Found ${prs.length} matching PR(s)`);
      } else {
        console.log(`  ✗ No matches`);
      }

      // For each PR, fetch its commits
      for (const pr of prs) {
        console.log(
          `  → Fetching commits for PR ${pr.pullRequestId}: "${pr.title}"`,
        );

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

    console.log(`\n=== Results ===`);
    console.log(`Total PRs found: ${results.length}\n`);

    res.json({
      success: true,
      searchCriteria: {
        sourceBranch: sourceBranch,
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

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const server = app.listen(PORT, () => {
  console.log(`\nServer running on http://localhost:${PORT}`);

  console.log(`\n=== ENDPOINTS ===`);

  console.log(`\n1. Search PRs by criteria (ALL 3 REQUIRED):`);
  console.log(`   GET /api/prs-with-commits`);
  console.log(`   Parameters: source=branch&target=branch&date=MM/DD/YYYY`);
  console.log(`   Example: ?source=ar-mc&target=ent-uat-v2&date=05/05/2026`);

  console.log(`\n2. Health check:`);
  console.log(`   GET /health\n`);
});

// Handle server errors
server.on("error", (err) => {
  console.error("Server error:", err);
  process.exit(1);
});

// Handle process errors
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  process.exit(1);
});
