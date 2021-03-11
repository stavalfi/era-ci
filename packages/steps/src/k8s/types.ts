import * as k8s from '@kubernetes/client-node'

export enum DeploymentStatus {
  NotReadyYet = 'NotReadYet',
  PodFailed = 'pod-failed',
  ThereWasAddtionalDeployment = 'there-was-addtional-deployment',
  Timeout = 'timeout',
  Succees = 'success',
  deleted = 'deleted',
  added = 'created',
}

export type DeploymentWatchResult =
  | {
      status: DeploymentStatus.Succees | DeploymentStatus.added | DeploymentStatus.deleted
    }
  | { status: DeploymentStatus.Timeout; replicateSetNameWithTimeout: string }
  | { status: DeploymentStatus.ThereWasAddtionalDeployment; newDeploymentGeneration: number }
  | { status: DeploymentStatus.PodFailed; reasons: PodFailureReason[]; podName: string }

export type DeploymentEvent = { eventType: WatchEventType; resource: k8s.V1Deployment; resourceKind: 'deployment' }
export type PodEvent = { eventType: WatchEventType; resource: k8s.V1Pod; resourceKind: 'pod' }

export enum WatchEventType {
  Modified = 'modified',
  Deleted = 'deleted',
  Added = 'created',
}

export enum PodFailureReason {
  ImagePullBackOff = 'ImagePullBackOff',
  CrashLoopBackOff = 'CrashLoopBackOff',
}

export type k8sDeploymentConfiguration = {
  isStepEnabled: boolean
  kubeConfigBase64: string
  k8sNamesapce: string
  artifactNameToDeploymentName: (options: { artifactName: string }) => string
  artifactNameToContainerName: (options: { artifactName: string }) => string
  useImageFromPackageName?: (options: { artifactName: string }) => string
  ignorePackageNames?: string[]
  failDeplomentOnPodError: boolean
}
