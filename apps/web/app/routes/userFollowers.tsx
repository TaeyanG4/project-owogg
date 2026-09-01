import { ProfileConnectionsPage } from "../components/profile/ProfileConnectionsPage";

export function meta() {
  return [{ title: "팔로워 | OwOGG" }];
}

export default function UserFollowersRoute() {
  return <ProfileConnectionsPage kind="followers" />;
}
