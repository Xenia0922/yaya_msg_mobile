export interface NavItem {
  title: string;
  desc: string;
  route: string;
  params?: any;
  icon: string;
}

export interface LiveCardItem {
  liveId: string;
  title: string;
  nickname: string;
  cover: string;

  userId: string;
}
