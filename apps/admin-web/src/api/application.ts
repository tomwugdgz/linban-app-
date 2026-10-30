// 四审工作台 API（契约 5.2；realname/face 人工复核、exam-pass、activate 为前端补充）
import { http } from './request';
import type { CompanionApplication, PageQuery, PageResult } from '@/shared/types';

export const applicationApi = {
  list(params: PageQuery & { stage?: string; keyword?: string }) {
    return http.get<PageResult<CompanionApplication>>('/admin/companion-applications', params);
  },
  detail(applicationNo: string) {
    return http.get<CompanionApplication>(`/admin/companion-applications/${applicationNo}`);
  },
  /** 前端补充：①实名人工复核（OCR 适配器结果存疑时） */
  reviewRealname(applicationNo: string, action: 'PASS' | 'REJECT', comment: string) {
    return http.post<CompanionApplication>(`/admin/companion-applications/${applicationNo}/realname`, { action, comment });
  },
  /** 前端补充：②人脸人工复核（慧眼分值边缘时） */
  reviewFace(applicationNo: string, action: 'PASS' | 'REJECT', comment: string) {
    return http.post<CompanionApplication>(`/admin/companion-applications/${applicationNo}/face`, { action, comment });
  },
  /** 契约：③无犯罪记录审核裁定 */
  reviewCriminal(applicationNo: string, action: 'PASS' | 'REJECT', comment: string) {
    return http.post<CompanionApplication>(`/admin/companion-applications/${applicationNo}/criminal`, { action, comment });
  },
  /** 前端补充：培训后考试通过（运营代录） */
  examPass(applicationNo: string, examScore: number) {
    return http.post<CompanionApplication>(`/admin/companion-applications/${applicationNo}/exam-pass`, { examScore });
  },
  /** 契约：保证金到账确认（进账即激活接单资格） */
  depositConfirm(applicationNo: string) {
    return http.post<CompanionApplication>(`/admin/companion-applications/${applicationNo}/deposit-confirm`);
  },
  /** 前端补充：四审终审上架 */
  activate(applicationNo: string) {
    return http.post<CompanionApplication>(`/admin/companion-applications/${applicationNo}/activate`);
  },
};
