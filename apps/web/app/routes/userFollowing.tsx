import { ProfileConnectionsPage } from "../components/profile/ProfileConnectionsPage";

export function meta() {
  return [{ title: "팔로잉 | OwOGG" }];
}

export default function UserFollowingRoute() {
  return <ProfileConnectionsPage kind="following" />;
}
