import { createRouter, createWebHistory } from 'vue-router';
import FeedView from '../views/FeedView.vue';
import HistoryView from '../views/HistoryView.vue';
import LikesView from '../views/LikesView.vue';
import FavoritesView from '../views/FavoritesView.vue';
import ReportedPostsView from '../views/ReportedPostsView.vue';
import PostViewerView from '../views/PostViewerView.vue';
import ProfileView from '../views/ProfileView.vue';
import ProfileSettingsView from '../views/ProfileSettingsView.vue';
import ProfileAnalyticsView from '../views/ProfileAnalyticsView.vue';
import ProfilesView from '../views/ProfilesView.vue';

const routes = [
  {
    path: '/',
    name: 'Home',
    component: FeedView,
  },
  {
    path: '/history',
    name: 'History',
    component: HistoryView,
  },
  {
    path: '/likes',
    name: 'Likes',
    component: LikesView,
  },
  {
    path: '/favorites',
    name: 'Favorites',
    component: FavoritesView,
  },
  {
    path: '/reported',
    name: 'Reported',
    component: ReportedPostsView,
  },
  {
    path: '/view/:source',
    name: 'Viewer',
    component: PostViewerView,
    props: true,
  },
  {
    path: '/profile',
    name: 'Profile',
    component: ProfileView,
  },
  {
    path: '/profile/settings',
    name: 'ProfileSettings',
    component: ProfileSettingsView,
  },
  {
    path: '/profile/analytics',
    name: 'ProfileAnalytics',
    component: ProfileAnalyticsView,
  },
  {
    path: '/profile/profiles',
    name: 'Profiles',
    component: ProfilesView,
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

export default router; 