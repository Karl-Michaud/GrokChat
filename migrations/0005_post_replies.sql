-- GROKCHAT-17: replies. A post may answer someone else's post on X: part 1 is sent with
-- `reply.in_reply_to_tweet_id` set to this id, later parts chain as before. Null: an original post.
ALTER TABLE posts ADD COLUMN reply_to_x_post_id TEXT;
