// ============================================================================
// 邻伴 · 腾讯云慧眼人脸核身适配器（adapters 层）
// ----------------------------------------------------------------------------
// 场景：
//   1. 入驻②人脸：活体检测 + 底照留存（L4 内容只进 COS 私有桶）；
//   2. 到岗核销：活体 + 与入驻底照比对（架构 §8.1 门闩规则 2）。
//
// 真实集成点 TODO：
//   · SDK：tencentcloud-sdk-nodejs（iai 模块：DetectLiveFace / CompareFace）；
//   · 凭证：TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY /
//     TENCENTCLOUD_REGION / FACE_VERIFY_BIZ_ID（规则名 BusinessId）；
//   · 输入：COS 私有桶 objectKey（服务端取临时 URL 送检）；
//   · 输出：score（0–100），阈值 face_match_threshold 由 domain 比对。
// ============================================================================

import { AppError } from '@linban/shared';

export interface FaceVerifyAdapter {
  /** 活体检测（静默/动作活体，返回活体分与是否通过） */
  livenessDetect(input: LivenessInput): Promise<LivenessResult>;
  /** 人脸比对（核销照 vs 入驻底照，返回比对分） */
  compareFace(input: CompareFaceInput): Promise<CompareFaceResult>;
}

export interface LivenessInput {
  /** 活体视频/照片的 COS objectKey（L4 内容，不落库原文） */
  videoObjectKey: string;
  /** 慧眼规则名（BusinessId） */
  bizId?: string;
}

export interface LivenessResult {
  livenessScore: number; // 0–100
  passed: boolean;
}

export interface CompareFaceInput {
  /** 现场核销照 objectKey */
  photoObjectKey: string;
  /** 入驻底照 objectKey（companions 主档引用 file_meta） */
  basePhotoObjectKey: string;
}

export interface CompareFaceResult {
  score: number; // 0–100 比对分
  passed: boolean; // 按阈值判定结果（服务层以 domain 阈值为准再校）
}

/** Mock：确定性通过（score 92），便于主链路联调 */
export class MockFaceVerifyAdapter implements FaceVerifyAdapter {
  async livenessDetect(input: LivenessInput): Promise<LivenessResult> {
    if (!input.videoObjectKey) throw new AppError(16006, '活体检测缺少视频对象');
    return { livenessScore: 95, passed: true };
  }

  async compareFace(input: CompareFaceInput): Promise<CompareFaceResult> {
    if (!input.photoObjectKey || !input.basePhotoObjectKey) {
      throw new AppError(16005, '人脸比对缺少照片对象');
    }
    return { score: 92, passed: true };
  }
}

/** 真实适配器骨架 */
export class RealFaceVerifyAdapter implements FaceVerifyAdapter {
  async livenessDetect(_input: LivenessInput): Promise<LivenessResult> {
    // TODO(真实集成)：iai.DetectLiveFace（videoBase64/VideoUrl + LivenessType）
    throw new AppError(90004, '真实慧眼活体检测未实现');
  }
  async compareFace(_input: CompareFaceInput): Promise<CompareFaceResult> {
    // TODO(真实集成)：iai.CompareFace（ImageA/ImageB）
    throw new AppError(90004, '真实慧眼人脸比对未实现');
  }
}

export function getFaceVerifyAdapter(): FaceVerifyAdapter {
  const configured = Boolean(process.env.TENCENTCLOUD_SECRET_ID && process.env.FACE_VERIFY_BIZ_ID);
  if (configured) {
    console.warn('[adapter:face] 检测到慧眼凭证，但真实实现未完成，暂回落 mock');
  }
  return new MockFaceVerifyAdapter();
}
