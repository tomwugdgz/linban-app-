// ============================================================================
// 邻伴 · 腾讯地图适配器（adapters 层：地理编码 / 距离 / 逆地理编码）
// ----------------------------------------------------------------------------
// 场景：派单就近匹配（GeoHash + 距离）、导航、签到 GPS 偏差计算前置。
// 隐私纪律（架构 §5.3 / DATABASE.md §6.1）：GPS 全精度不落库——
// 本适配器只把坐标交给服务端距离计算，落库前由 service 层模糊化至百米级。
//
// 真实集成点 TODO：
//   · API：WebService API（地理编码 geocoder / 距离 distance / 逆地理编码）；
//   · 凭证：MAP_KEY（见 .env.example）；
//   · 限流：5 次/秒（个人 key），批量场景走就近缓存。
// ============================================================================

import { AppError } from '@linban/shared';

export interface MapAdapter {
  /** 地址 → 坐标（下单地址规范化） */
  geocode(address: string): Promise<GeocodeResult>;
  /** 两点距离（米，供派单打分与偏差计算） */
  distance(origin: LatLng, destination: LatLng): Promise<number>;
  /** 坐标 → 地址（模糊化后的展示地址） */
  reverseGeocode(latlng: LatLng): Promise<ReverseGeocodeResult>;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeocodeResult {
  latlng: LatLng;
  formattedAddress: string;
  /** 省/市/区（脱敏展示用） */
  province: string;
  city: string;
  district: string;
}

export interface ReverseGeocodeResult {
  formattedAddress: string;
  district: string;
}

/** Mock：广州市中心假坐标 + 按勾股估算距离（联调用） */
export class MockMapAdapter implements MapAdapter {
  async geocode(address: string): Promise<GeocodeResult> {
    if (!address) throw new AppError(10001, '地址不能为空');
    return {
      latlng: { lat: 23.1291, lng: 113.2644 }, // 广州城区附近
      formattedAddress: `广东省广州市越秀区${address}`,
      province: '广东省',
      city: '广州市',
      district: '越秀区',
    };
  }

  async distance(origin: LatLng, destination: LatLng): Promise<number> {
    // mock：平面近似（1° ≈ 111km），仅供联调排序
    const dx = (destination.lng - origin.lng) * 111000 * Math.cos((origin.lat * Math.PI) / 180);
    const dy = (destination.lat - origin.lat) * 111000;
    return Math.round(Math.sqrt(dx * dx + dy * dy));
  }

  async reverseGeocode(latlng: LatLng): Promise<ReverseGeocodeResult> {
    if (!Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) {
      throw new AppError(10001, '坐标不合法');
    }
    return { formattedAddress: '广东省广州市越秀区（mock 解析地址）', district: '越秀区' };
  }
}

/** 真实适配器骨架 */
export class RealMapAdapter implements MapAdapter {
  async geocode(_address: string): Promise<GeocodeResult> {
    // TODO(真实集成)：GET https://apis.map.qq.com/ws/geocoder/v1?key=MAP_KEY
    throw new AppError(90004, '真实地图地理编码未实现');
  }
  async distance(_origin: LatLng, _destination: LatLng): Promise<number> {
    // TODO(真实集成)：GET https://apis.map.qq.com/ws/distance/v1?mode=driving
    throw new AppError(90004, '真实地图距离计算未实现');
  }
  async reverseGeocode(_latlng: LatLng): Promise<ReverseGeocodeResult> {
    // TODO(真实集成)：GET https://apis.map.qq.com/ws/geocoder/v1?location=
    throw new AppError(90004, '真实地图逆地理编码未实现');
  }
}

export function getMapAdapter(): MapAdapter {
  if (process.env.MAP_KEY) {
    console.warn('[adapter:map] 检测到地图 Key，但真实实现未完成，暂回落 mock');
  }
  return new MockMapAdapter();
}
