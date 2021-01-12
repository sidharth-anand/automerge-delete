import * as core from '@actions/core'
import * as github from '@actions/github'

import {Octokit, PullRequest, Review, CheckRun} from './types'

export const UNMERGEABLE_STATES = ['blocked']

export function isChangesRequested(review: Review): boolean {
  return review.state.toUpperCase() === 'CHANGES_REQUESTED'
}

export function isApproved(review: Review): boolean {
  return review.state.toUpperCase() === 'APPROVED'
}

export function isAuthorAllowed(
  pullRequestOrReview: PullRequest | Review,
  authorAssociations: string[]
): boolean {
  if (pullRequestOrReview.user?.login === 'github-actions[bot]') {
    return true
  }

  if (!pullRequestOrReview.author_association) {
    return false
  }

  return authorAssociations.includes(pullRequestOrReview.author_association)
}

export function relevantReviewsForCommit(
  reviews: Review[],
  reviewAuthorAssociations: string[],
  commit: string
): Review[] {
  return reviews
    .filter(review => review.commit_id === commit)
    .filter(review => {
      const isRelevant = isApproved(review) || isChangesRequested(review)
      if (!isRelevant) {
        core.debug(`Review ${review.id} for commit ${commit} is not relevant.`)
        return false
      }

      const isReviewAuthorAllowed = isAuthorAllowed(
        review,
        reviewAuthorAssociations
      )
      if (!isReviewAuthorAllowed) {
        core.debug(
          `Author @${review.user?.login} (${review.author_association}) of review ${review.id} for commit ${commit} is not allowed.`
        )
        return false
      }

      return true
    })
    .sort((a, b) => {
      const submittedA = a.submitted_at
      const submittedB = b.submitted_at

      return submittedA && submittedB
        ? Date.parse(submittedB) - Date.parse(submittedA)
        : 0
    })
    .reduce(
      (acc: Review[], review) =>
        acc.some(r => {
          const loginA = r.user?.login
          const loginB = review.user?.login

          return loginA && loginB && loginA === loginB
        })
          ? acc
          : [...acc, review],
      []
    )
    .reverse()
}

export async function requiredStatusChecksForBranch(
  octokit: Octokit,
  branchName: string
): Promise<string[]> {
  const branch = (
    await octokit.repos.getBranch({
      ...github.context.repo,
      branch: branchName
    })
  ).data

  if (branch.protected === true && branch.protection.enabled === true) {
    return branch.protection.required_status_checks.contexts ?? []
  }

  return []
}

export async function passedRequiredStatusChecks(
  octokit: Octokit,
  pullRequest: PullRequest,
  requiredChecks: string[]
): Promise<boolean> {
  const checkRuns = (
    await octokit.checks.listForRef({
      ...github.context.repo,
      ref: pullRequest.head.sha
    })
  ).data.check_runs

  return requiredChecks.every(requiredCheck =>
    checkRuns.some(
      checkRun =>
        checkRun.name === requiredCheck && checkRun.conclusion === 'success'
    )
  )
}

// Loosely match a “do not merge” label's name.
export function isDoNotMergeLabel(string: string): boolean {
  const label = string.toLowerCase().replace(/[^a-z0-9]/g, '')
  const match = label.match(/^dono?tmerge$/)
  return match != null
}

export async function pullRequestsForCheckRun(
  octokit: Octokit,
  checkRun: CheckRun
): Promise<number> {
  const pullRequests = checkRun.pull_requests?.map(({number}) => number) ?? []

  return pullRequests[0]
}
