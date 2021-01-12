import * as core from '@actions/core'
import * as github from '@actions/github'

import {Input} from './input'
import {AutomergeAction} from './action'

async function run(): Promise<void> {
  try {
    const input = new Input()

    const octokit = github.getOctokit(input.token)

    const action = new AutomergeAction(octokit, input)

    if (input.pullRequest) {
      await action.automergePullRequests([input.pullRequest])
      return
    }

    const eventName = github.context.eventName
    switch (eventName) {
      case 'check_run': {
        await action.handleCheckRun()
        break
      }
      default: {
        core.warning(`This action does not support the '${eventName}' event.`)
        break
      }
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
