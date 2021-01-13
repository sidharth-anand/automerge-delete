import * as core from '@actions/core'
import * as github from '@actions/github'
import {isPresent} from 'ts-is-present'

import {Input} from './input'
import {
  isAuthorAllowed,
  passedRequiredStatusChecks,
  requiredStatusChecksForBranch,
  pullRequestsForCheckRun
} from './helpers'
import {MergeMethod, Octokit} from './types'

export class AutomergeAction {
  octokit: Octokit
  input: Input

  constructor(octokit: Octokit, input: Input) {
    this.octokit = octokit
    this.input = input
  }

  async automergePullRequests(numbers: number[]): Promise<void> {
    const maxTries = 5
    const retries = maxTries - 1

    const queue = numbers.map(number => ({number, tries: 0}))

    let arg
    while ((arg = queue.shift())) {
      const {number, tries} = arg

      if (tries > 0) {
        await new Promise(r => setTimeout(r, 2 ** tries * 1000))
      }

      const triesLeft = retries - tries
      const retry = await this.automergePullRequest(number, triesLeft)

      if (retry) {
        queue.push({number, tries: tries + 1})
      }

      core.info('')
    }
  }

  async determineMergeMethod(): Promise<MergeMethod> {
    if (this.input.mergeMethod) {
      return this.input.mergeMethod
    }

    const repo = (await this.octokit.repos.get({...github.context.repo})).data

    if (repo.allow_merge_commit === true) {
      return 'merge'
    } else if (repo.allow_squash_merge === true) {
      return 'squash'
    } else if (repo.allow_rebase_merge === true) {
      return 'rebase'
    } else {
      return undefined
    }
  }

  async automergePullRequest(
    number: number,
    triesLeft: number
  ): Promise<boolean> {
    core.info(`Evaluating mergeability for pull request ${number}:`)

    const pullRequest = (
      await this.octokit.pulls.get({
        ...github.context.repo,
        pull_number: number
      })
    ).data

    if (pullRequest.merged === true) {
      core.info(`Pull request ${number} is already merged.`)
      return false
    }

    if (pullRequest.state === 'closed') {
      core.info(`Pull request ${number} is closed.`)
      return false
    }

    const authorAssociations = this.input.pullRequestAuthorAssociations
    if (
      authorAssociations.length > 0 &&
      !isAuthorAllowed(pullRequest, authorAssociations)
    ) {
      core.info(
        `Author of pull request ${number} is ${pullRequest.author_association} but must be one of the following: ` +
          `${authorAssociations.join(', ')}`
      )
      return false
    }

    const baseBranch = pullRequest.base.ref
    const headBranch = pullRequest.head.ref
    const requiredStatusChecks = await requiredStatusChecksForBranch(
      this.octokit,
      baseBranch
    )

    if (
      !(await passedRequiredStatusChecks(
        this.octokit,
        pullRequest,
        requiredStatusChecks
      ))
    ) {
      core.info(
        `Required status checks for pull request ${number} are not successful.`
      )
      return false
    }

    const labels = pullRequest.labels.map(({name}) => name).filter(isPresent)
    const doNotMergeLabels = labels.filter(label =>
      this.input.isDoNotMergeLabel(label)
    )

    if (doNotMergeLabels.length > 0) {
      core.info(
        `Pull request ${number} is not mergeable because the following labels are applied: ` +
          `${doNotMergeLabels.join(', ')}`
      )
      return false
    }

    const mergeableState = pullRequest.mergeable_state
    switch (mergeableState) {
      case 'draft': {
        core.info(
          `Pull request ${number} is not mergeable because it is a draft.`
        )
        return false
      }
      case 'dirty': {
        core.info(
          `Pull request ${number} is not mergeable because it is dirty.`
        )
        return false
      }
      case 'blocked': {
        core.info(`Merging is blocked for pull request ${number}.`)
        return false
      }
      case 'clean':
      case 'has_hooks':
      case 'unknown':
      case 'unstable': {
        core.info(
          `Pull request ${number} is mergeable with state '${mergeableState}'.`
        )

        const mergeMethod = await this.determineMergeMethod()

        const useTitle = this.input.squashTitle && mergeMethod === 'squash'
        const commitTitle = useTitle
          ? `${pullRequest.title} (#${pullRequest.number})`
          : undefined
        const commitMessage = useTitle ? '\n' : undefined

        const titleMessage = useTitle
          ? ` with title '${commitTitle}'`
          : undefined

        if (this.input.dryRun) {
          core.info(`Would try merging pull request ${number}${titleMessage}.`)
          return false
        }

        try {
          core.info(`Merging pull request ${number}${titleMessage}:`)
          await this.octokit.pulls.merge({
            ...github.context.repo,
            pull_number: number,
            sha: pullRequest.head.sha,
            merge_method: mergeMethod,
            commit_title: commitTitle,
            commit_message: commitMessage
          })

          core.info(`Successfully merged pull request ${number}.`)

          try {
            core.info(`Deleting branch ${headBranch} after successful merge:`)

            await this.octokit.git.deleteRef({
              ...github.context.repo,
              ref: headBranch
            })

            core.info(`Successfully deleted branch ${headBranch}`)
          } catch (error) {
            core.error(
              `Could not delete branch ${headBranch}: ${error.message}`
            )
          }

          return false
        } catch (error) {
          const message = `Failed to merge pull request ${number} (${triesLeft} tries left): ${error.message}`
          if (triesLeft === 0) {
            core.setFailed(message)
            return false
          } else {
            core.error(message)
            return true
          }
        }
      }
      default: {
        core.warning(
          `Unknown state for pull request ${number}: '${mergeableState}'`
        )
        return false
      }
    }
  }

  async handleCheckRun(): Promise<void> {
    core.debug('handleCheckRun()')

    const {action, check_run: checkRun} = github.context.payload

    if (!action || !checkRun) {
      return
    }

    if (checkRun.conclusion !== 'success') {
      core.info(
        `Conclusion for check suite ${checkRun.id} is ${checkRun.conclusion}, not attempting to merge.`
      )
      return
    }

    const pullRequest = await pullRequestsForCheckRun(this.octokit, checkRun)

    await this.automergePullRequests([pullRequest])
  }
}
