import * as core from '@actions/core'

import {isDoNotMergeLabel} from './helpers'
import {MergeMethod} from './types'

function getNumber(input: string, options?: core.InputOptions): number | null {
  const stringValue = core.getInput(input, options)

  if (!stringValue) {
    return null
  }

  const numberValue = parseInt(stringValue, 10)

  if (isNaN(numberValue)) {
    throw new Error(
      `Failed parsing input '${input}' to number: '${stringValue}'`
    )
  }

  return numberValue
}

function getArray(input: string, options?: core.InputOptions): string[] {
  const stringValue = core.getInput(input, options)
  return (stringValue || null)?.split(',') ?? []
}

export class Input {
  token: string
  mergeMethod: MergeMethod
  squashTitle: boolean
  doNotMergeLabels: string[]
  pullRequest: number | null
  pullRequestAuthorAssociations: string[]
  reviewAuthorAssociations: string[]
  dryRun: boolean
  deleteOnMerge: boolean

  constructor() {
    this.token = core.getInput('token', {required: true})

    const mergeMethod = core.getInput('merge-method') || undefined
    switch (mergeMethod) {
      case 'squash':
      case 'rebase':
      case 'merge':
      case undefined: {
        this.mergeMethod = mergeMethod
        break
      }
      default: {
        throw new Error(`Unknown merge method: '${mergeMethod}'`)
      }
    }

    this.squashTitle = core.getInput('squash-title') === 'true'

    this.doNotMergeLabels = getArray('do-not-merge-labels')

    this.pullRequest = getNumber('pull-request')
    this.pullRequestAuthorAssociations = getArray(
      'pull-request-author-associations'
    )
    this.reviewAuthorAssociations = getArray('review-author-associations')
    if (this.reviewAuthorAssociations.length === 0) {
      this.reviewAuthorAssociations = ['COLLABORATOR', 'MEMBER', 'OWNER']
    }

    this.dryRun = core.getInput('dry-run') === 'true'

    this.deleteOnMerge = core.getInput('delete-on-merge') === 'true'
  }

  isDoNotMergeLabel(label: string): boolean {
    return this.doNotMergeLabels.includes(label) || isDoNotMergeLabel(label)
  }
}
