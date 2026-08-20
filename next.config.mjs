/** @type {import('next').NextConfig} */
const isGithubActions = process.env.GITHUB_ACTIONS || false;
let repoName = "";

if (isGithubActions && process.env.GITHUB_REPOSITORY) {
  const fullRepo = process.env.GITHUB_REPOSITORY; // e.g. "user/vision-pass"
  const repo = fullRepo.split("/")[1];
  // Only add repo prefix if it's not a user.github.io root page
  if (repo && !repo.endsWith(".github.io")) {
    repoName = `/${repo}`;
  }
}

const nextConfig = {
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || (repoName ? repoName : undefined),
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
  webpack: (config) => {
    // Handling canvas / node modules if required by tesseract/exceljs on client
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };
    return config;
  },
};

export default nextConfig;
